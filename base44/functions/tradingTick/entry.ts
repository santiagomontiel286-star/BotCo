import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const SUPPORTED_PAIRS = ['XBTUSD', 'XBTEUR', 'ETHUSD', 'ETHEUR'];
const QUOTE_KEYS = { USD: ['ZUSD', 'USD'], EUR: ['ZEUR', 'EUR'] };
let lastNonce = 0;

function nextNonce() {
  const now = Date.now() * 1000;
  lastNonce = Math.max(now, lastNonce + 1);
  return String(lastNonce);
}

function tickId() {
  return `tick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function envConfig() {
  const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'KRAKEN_LIVE_TRADING', 'BOTCO_LIVE_ENABLED', 'MAX_LIVE_ORDER_QUOTE', 'BOTCO_AUTOTRADE_INTERVAL_MINUTES'];
  const missing = required.filter(name => !Deno.env.get(name));
  const maxQuote = Number(Deno.env.get('MAX_LIVE_ORDER_QUOTE') || '0');
  const intervalMinutes = Number(Deno.env.get('BOTCO_AUTOTRADE_INTERVAL_MINUTES') || '5');
  return {
    missing,
    krakenLiveTrading: toBool(Deno.env.get('KRAKEN_LIVE_TRADING')),
    botcoLiveEnabled: toBool(Deno.env.get('BOTCO_LIVE_ENABLED')),
    maxQuote,
    intervalMinutes,
    ok: missing.length === 0 && toBool(Deno.env.get('KRAKEN_LIVE_TRADING')) && toBool(Deno.env.get('BOTCO_LIVE_ENABLED')) && maxQuote > 0 && maxQuote <= 25,
  };
}

function assertLiveEnv() {
  const env = envConfig();
  if (env.missing.length) throw new Error(`Faltan variables LIVE: ${env.missing.join(', ')}`);
  if (!env.krakenLiveTrading) throw new Error('KRAKEN_LIVE_TRADING debe ser true');
  if (!env.botcoLiveEnabled) throw new Error('BOTCO_LIVE_ENABLED debe ser true');
  if (!env.maxQuote || env.maxQuote <= 0) throw new Error('MAX_LIVE_ORDER_QUOTE debe ser mayor que 0');
  if (env.maxQuote > 25) throw new Error('MAX_LIVE_ORDER_QUOTE supera 25; LIVE bloqueado por seguridad');
  return env;
}

async function signKraken(path, postData, secret) {
  const nonce = new URLSearchParams(postData).get('nonce') || '';
  const secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const sha256 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce + postData));
  const pathBytes = new TextEncoder().encode(path);
  const message = new Uint8Array(pathBytes.length + sha256.byteLength);
  message.set(pathBytes, 0);
  message.set(new Uint8Array(sha256), pathBytes.length);
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, message);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function krakenPrivate(endpoint, params = {}) {
  const apiKey = Deno.env.get('KRAKEN_API_KEY');
  const apiSecret = Deno.env.get('KRAKEN_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Faltan KRAKEN_API_KEY o KRAKEN_API_SECRET');
  const path = `/0/private/${endpoint}`;
  const body = new URLSearchParams({ nonce: nextNonce(), ...params });
  const postData = body.toString();
  const response = await fetch(`${KRAKEN_API}${path}`, {
    method: 'POST',
    headers: { 'API-Key': apiKey, 'API-Sign': await signKraken(path, postData, apiSecret), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: postData,
  });
  const json = await response.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return json.result;
}

async function krakenPublic(endpoint, params = {}) {
  const url = new URL(`${KRAKEN_API}/0/public/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const json = await response.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return json.result;
}

function normalizePair(pair) {
  const value = String(pair || '').replace('/', '').toUpperCase();
  if (value === 'BTCUSD') return 'XBTUSD';
  if (value === 'BTCEUR') return 'XBTEUR';
  if (value === 'XBT/EUR') return 'XBTEUR';
  if (value === 'XBT/USD') return 'XBTUSD';
  return value || 'XBTUSD';
}

function displayPair(pair) {
  const value = normalizePair(pair);
  if (value === 'XBTUSD') return 'BTC/USD';
  if (value === 'XBTEUR') return 'BTC/EUR';
  if (value === 'ETHUSD') return 'ETH/USD';
  if (value === 'ETHEUR') return 'ETH/EUR';
  return value;
}

function baseAsset(pair) {
  return normalizePair(pair).startsWith('XBT') ? 'XBT' : 'ETH';
}

function quoteCurrency(pair) {
  return normalizePair(pair).endsWith('EUR') ? 'EUR' : 'USD';
}

function getBalanceAmount(balances, currency) {
  return (QUOTE_KEYS[currency] || [currency]).reduce((sum, key) => sum + Number(balances[key] || 0), 0);
}

function getAssetBalance(balances, asset) {
  if (asset === 'XBT') return Number(balances.XXBT || balances.XBT || balances.BTC || 0);
  if (asset === 'ETH') return Number(balances.XETH || balances.ETH || 0);
  return 0;
}

async function getBalances() {
  return krakenPrivate('Balance');
}

async function getCurrentPrice(pair) {
  const result = await krakenPublic('Ticker', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const ticker = result[key];
  const ask = Number(ticker.a?.[0] || 0);
  const bid = Number(ticker.b?.[0] || 0);
  const last = Number(ticker.c?.[0] || 0);
  if (!last || !ask || !bid || ask <= bid) throw new Error(`Precio/spread inválido para ${displayPair(pair)}`);
  return { price: last, bid, ask, spreadPct: ((ask - bid) / last) * 100 };
}

async function getAssetPairRules(pair) {
  const result = await krakenPublic('AssetPairs', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const raw = result[key] || {};
  return {
    pair: normalizePair(pair),
    ordermin: Number(raw.ordermin || 0),
    costmin: Number(raw.costmin || 0),
    lot_decimals: Number(raw.lot_decimals ?? 8),
    pair_decimals: Number(raw.pair_decimals ?? 2),
  };
}

async function getCandles(pair, interval = 1) {
  const result = await krakenPublic('OHLC', { pair: normalizePair(pair), interval });
  const key = Object.keys(result).find(item => item !== 'last');
  return (result[key] || []).slice(-60).map(row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) }));
}

function roundDown(value, decimals) {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
}

function calculateValidVolume(maxQuote, price, rules) {
  const volume = roundDown(maxQuote / price, rules.lot_decimals);
  const cost = volume * price;
  if (!volume || volume <= 0) return { ok: false, reason: 'Volumen calculado inválido', volume, cost };
  if (rules.ordermin && volume < rules.ordermin) return { ok: false, reason: `Volumen ${volume} menor al mínimo Kraken ${rules.ordermin}`, volume, cost };
  if (rules.costmin && cost < rules.costmin) return { ok: false, reason: `Coste ${cost.toFixed(2)} menor al mínimo Kraken ${rules.costmin}`, volume, cost };
  return { ok: true, volume, cost };
}

async function chooseBestQuoteCurrency(bot, balances, maxQuote) {
  const requested = (bot.pairs?.length ? bot.pairs : SUPPORTED_PAIRS).map(normalizePair).filter(pair => SUPPORTED_PAIRS.includes(pair));
  const preferred = requested.length ? requested : SUPPORTED_PAIRS;
  const ordered = [...preferred, ...SUPPORTED_PAIRS.filter(pair => !preferred.includes(pair))];
  for (const pair of ordered) {
    const quote = quoteCurrency(pair);
    const available = getBalanceAmount(balances, quote);
    if (available >= maxQuote) return { pair, quote, available };
  }
  return { error: `Balance insuficiente: se necesitan al menos ${maxQuote} USD/EUR disponibles para BTC o ETH` };
}

async function placeMarketOrder(pair, side, volume) {
  return krakenPrivate('AddOrder', { pair: normalizePair(pair), type: side, ordertype: 'market', volume: String(volume), validate: 'false' });
}

async function closeTradeMarket(trade, currentPrice) {
  const pair = normalizePair(trade.pair);
  const asset = baseAsset(pair);
  const balances = await getBalances();
  const availableAsset = getAssetBalance(balances, asset);
  const requested = Number(trade.amount || 0) * 0.995;
  const closeAmount = Math.min(requested, availableAsset * 0.995);
  const rules = await getAssetPairRules(pair);
  const volume = roundDown(closeAmount, rules.lot_decimals);
  if (!volume || volume <= 0 || (rules.ordermin && volume < rules.ordermin)) throw new Error(`Volumen de cierre inferior al mínimo Kraken para ${displayPair(pair)}`);
  if (rules.costmin && volume * currentPrice < rules.costmin) throw new Error(`Coste de cierre inferior al mínimo Kraken para ${displayPair(pair)}`);
  return { response: await placeMarketOrder(pair, trade.side === 'buy' ? 'sell' : 'buy', volume), volume };
}

async function queryOrderIfPossible(txid) {
  if (!txid) return null;
  try {
    return await krakenPrivate('QueryOrders', { txid });
  } catch {
    return null;
  }
}

function ema(values, period) {
  if (values.length < period) return values[values.length - 1] || 0;
  const k = 2 / (period + 1);
  return values.slice(1).reduce((prev, value) => value * k + prev * (1 - k), values[0]);
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  const slice = values.slice(-period - 1);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

async function evaluateStrategy(bot, pair, ticker) {
  const strategy = bot.strategy || 'ema_cross';
  const interval = strategy === 'micro_scalp' || strategy === 'first_live_trade' ? 1 : 5;
  const candles = await getCandles(pair, interval);
  const closes = candles.map(candle => candle.close);
  const recent = candles.slice(-3);
  const currentRsi = rsi(closes);
  const fallingHard = recent.length === 3 && recent.every(candle => candle.close < candle.open) && ((recent[0].open - recent[2].close) / recent[0].open) * 100 > 0.25;

  if (ticker.spreadPct > 0.20) return { action: 'skip', reason: `Spread alto ${ticker.spreadPct.toFixed(3)}%`, confidence: 0 };
  if (strategy === 'first_live_trade') return { action: 'buy', reason: `first_live_trade: spread ${ticker.spreadPct.toFixed(3)}%, mercado líquido`, confidence: 0.65 };
  if (strategy === 'micro_scalp' || strategy === 'micro_scalp_test') {
    if (fallingHard) return { action: 'skip', reason: 'Últimas velas fuertemente bajistas', confidence: 0.2 };
    if (currentRsi >= 78) return { action: 'skip', reason: `RSI extremo ${currentRsi.toFixed(1)}`, confidence: 0.2 };
    return { action: 'buy', reason: `micro_scalp: spread ${ticker.spreadPct.toFixed(3)}%, RSI ${currentRsi.toFixed(1)}`, confidence: 0.7 };
  }
  const emaFast = ema(closes.slice(-30), 9);
  const emaSlow = ema(closes.slice(-60), 21);
  if (emaFast > emaSlow && currentRsi < 75) return { action: 'buy', reason: `ema_cross: EMA9 ${emaFast.toFixed(2)} > EMA21 ${emaSlow.toFixed(2)}`, confidence: 0.72 };
  return { action: 'skip', reason: `Sin señal alcista: EMA9 ${emaFast.toFixed(2)} / EMA21 ${emaSlow.toFixed(2)}`, confidence: 0.35 };
}

function shouldCloseTrade(trade, ticker, forceClose, bot) {
  if (forceClose) return { close: true, reason: 'Cierre manual solicitado' };
  const entry = Number(trade.entry_price || 0);
  const amount = Number(trade.amount || 0);
  if (!entry || !amount) return { close: false, reason: 'Trade sin entrada o volumen válido' };
  const pnlPct = ((ticker.price - entry) / entry) * (trade.side === 'buy' ? 1 : -1) * 100;
  const ageMs = Date.now() - new Date(trade.entry_date || trade.created_date).getTime();
  const tp = Number(bot?.take_profit ?? 0.05);
  const sl = Number(bot?.stop_loss ?? 0.20);
  if (pnlPct >= tp) return { close: true, reason: `TP ${tp}% alcanzado`, pnlPct };
  if (pnlPct <= -sl) return { close: true, reason: `SL -${sl}% alcanzado`, pnlPct };
  if (ageMs >= 10 * 60 * 1000) return { close: true, reason: 'Timeout 10 minutos', pnlPct };
  return { close: false, reason: 'Monitoreando operación abierta', pnlPct };
}

async function createAlert(entities, title, message, severity = 'info') {
  await entities.Alert.create({ title, message, severity, source: 'tradingTick LIVE', is_read: false });
}

async function riskCheck(entities, bot, session, pair, balances, maxQuote, openTrades) {
  if (bot.status !== 'active' || bot.trading_mode !== 'live' || bot.live_enabled !== true) return { ok: false, reason: 'Bot no está LIVE activo' };
  if (!session || session.active !== true || session.mode !== 'live') return { ok: false, reason: 'No hay BotSession LIVE activa' };
  if (bot.cooldown_until && new Date(bot.cooldown_until).getTime() > Date.now()) return { ok: false, reason: `Cooldown activo hasta ${bot.cooldown_until}` };
  if (openTrades.some(trade => trade.bot_name === bot.name && normalizePair(trade.pair) === normalizePair(pair))) return { ok: false, reason: 'Ya existe trade abierto para este bot/par' };
  const quote = quoteCurrency(pair);
  if (getBalanceAmount(balances, quote) < maxQuote) return { ok: false, reason: `Balance ${quote} insuficiente` };

  const recent = await entities.Trade.filter({ bot_name: bot.name, mode: 'live' }, '-created_date', 20);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayLoss = recent.filter(trade => new Date(trade.exit_date || trade.updated_date || trade.created_date).getTime() >= today.getTime()).reduce((sum, trade) => sum + Math.min(0, Number(trade.profit_loss || 0)), 0);
  const dailyLossLimit = Number(bot.daily_loss_limit || 3);
  if (Math.abs(todayLoss) >= dailyLossLimit) return { ok: false, reason: `Pérdida diaria supera ${dailyLossLimit}` };
  const consecutiveLosses = recent.filter(trade => trade.status === 'closed').slice(0, 3).filter(trade => Number(trade.profit_loss || 0) < 0).length;
  if (consecutiveLosses >= 3) return { ok: false, reason: '3 pérdidas consecutivas del bot' };
  return { ok: true };
}

async function updateSession(entities, session, data) {
  if (session?.id) await entities.BotSession.update(session.id, data);
}

Deno.serve(async (req) => {
  const id = tickId();
  try {
    const base44 = createClientFromRequest(req);
    const entities = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    const validateOnly = payload.validateOnly === true;
    const forceClose = payload.forceClose === true;
    const runOnce = payload.runOnce === true;
    const autoMode = payload.autoMode === true;
    const user = await base44.auth.me().catch(() => null);
    if (!autoMode && !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const env = envConfig();
    const sessions = await entities.BotSession.filter({ active: true }, '-created_date', 5);
    const liveSession = sessions.find(session => session.mode === 'live');
    const bots = await entities.Bot.list();
    const liveBots = bots.filter(bot => bot.status === 'active' && bot.trading_mode === 'live' && bot.live_enabled === true && (bot.exchange || 'kraken') === 'kraken');

    if (validateOnly) {
      return Response.json({ ok: env.ok, ...env, liveSession: !!liveSession, liveBots: liveBots.length, message: env.ok ? 'Entorno LIVE válido' : 'Entorno LIVE incompleto o bloqueado' });
    }

    assertLiveEnv();
    if (!liveSession) return Response.json({ error: 'No hay BotSession LIVE activa' }, { status: 400 });
    if (!runOnce && !autoMode && !forceClose) return Response.json({ error: 'Payload inválido: usa runOnce, autoMode, forceClose o validateOnly' }, { status: 400 });
    if (!liveBots.length && !forceClose) return Response.json({ error: 'No hay bots LIVE activos' }, { status: 400 });

    const nowIso = new Date().toISOString();
    const results = [];
    const balances = await getBalances();
    let openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);

    for (const trade of openTrades) {
      const pair = normalizePair(trade.pair);
      const bot = bots.find(item => item.name === trade.bot_name);
      try {
        const ticker = await getCurrentPrice(pair);
        const decision = shouldCloseTrade(trade, ticker, forceClose, bot);
        if (!decision.close) {
          results.push({ action: 'monitoring', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), price: ticker.price, pnlPercent: decision.pnlPct, reason: decision.reason });
          continue;
        }
        const closed = await closeTradeMarket(trade, ticker.price);
        const closeOrderId = Array.isArray(closed.response.txid) ? closed.response.txid.join(',') : '';
        if (!closeOrderId) throw new Error('Kraken no devolvió txid de cierre');
        const pnl = (ticker.price - Number(trade.entry_price)) * Number(closed.volume) * (trade.side === 'buy' ? 1 : -1);
        const invested = Number(trade.entry_price) * Number(closed.volume);
        const pnlPct = invested ? (pnl / invested) * 100 : 0;
        await entities.Trade.update(trade.id, {
          status: 'closed',
          exit_price: ticker.price,
          exit_date: nowIso,
          profit_loss: Number(pnl.toFixed(8)),
          profit_loss_percent: Number(pnlPct.toFixed(4)),
          close_order_id: closeOrderId,
          closed_by_tick_id: id,
          raw_response: JSON.stringify({ open: trade.raw_response || '', close: closed.response }),
          notes: `LIVE cerrado: ${decision.reason}`,
        });
        await createAlert(entities, 'Orden LIVE cerrada', `${trade.bot_name} cerró ${displayPair(pair)} · PnL ${pnl.toFixed(6)}`, pnl >= 0 ? 'success' : 'warning');
        if (bot?.id) await entities.Bot.update(bot.id, { last_run_at: nowIso, last_signal: `closed: ${decision.reason}`, last_error: '', cooldown_until: new Date(Date.now() + 60_000).toISOString() });
        results.push({ action: 'closed', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), exitPrice: ticker.price, pnl, pnlPercent: pnlPct, closeOrderId, rawResponse: closed.response });
      } catch (error) {
        if (bot?.id) await entities.Bot.update(bot.id, { last_run_at: nowIso, last_error: error.message });
        await createAlert(entities, 'Error cerrando operación LIVE', `${trade.bot_name}: ${error.message}`, 'critical');
        results.push({ action: 'close_error', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), error: error.message });
      }
    }

    openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);
    if (!forceClose) {
      for (const bot of liveBots) {
        try {
          const maxQuote = Math.min(Number(bot.max_order_quote || bot.max_order_usd || env.maxQuote), env.maxQuote);
          if (maxQuote > 25) throw new Error('max_order_quote supera 25; bot bloqueado');
          const choice = await chooseBestQuoteCurrency(bot, balances, maxQuote);
          if (choice.error) throw new Error(choice.error);
          const ticker = await getCurrentPrice(choice.pair);
          const risk = await riskCheck(entities, bot, liveSession, choice.pair, balances, maxQuote, openTrades);
          if (!risk.ok) {
            await entities.Bot.update(bot.id, { last_run_at: nowIso, last_signal: `skip: ${risk.reason}`, last_error: '' });
            results.push({ action: 'skip', bot: bot.name, pair: displayPair(choice.pair), reason: risk.reason });
            continue;
          }
          const signal = await evaluateStrategy(bot, choice.pair, ticker);
          if (signal.action !== 'buy') {
            await entities.Bot.update(bot.id, { last_run_at: nowIso, last_signal: signal.reason, last_error: '' });
            results.push({ action: 'skip', bot: bot.name, pair: displayPair(choice.pair), reason: signal.reason, confidence: signal.confidence });
            continue;
          }
          const rules = await getAssetPairRules(choice.pair);
          const volume = calculateValidVolume(maxQuote, ticker.price, rules);
          if (!volume.ok) {
            await entities.Bot.update(bot.id, { last_run_at: nowIso, last_signal: `skip: ${volume.reason}`, last_error: '' });
            await createAlert(entities, 'Capital insuficiente para orden LIVE', `${bot.name} ${displayPair(choice.pair)}: ${volume.reason}`, 'warning');
            results.push({ action: 'skip', bot: bot.name, pair: displayPair(choice.pair), reason: volume.reason });
            continue;
          }
          const orderResponse = await placeMarketOrder(choice.pair, 'buy', volume.volume);
          const exchangeOrderId = Array.isArray(orderResponse.txid) ? orderResponse.txid.join(',') : '';
          if (!exchangeOrderId) throw new Error('Kraken no devolvió txid de apertura');
          const trade = await entities.Trade.create({
            exchange: 'kraken',
            mode: 'live',
            bot_name: bot.name,
            pair: displayPair(choice.pair),
            side: 'buy',
            entry_price: ticker.price,
            amount: volume.volume,
            status: 'open',
            stop_loss: Number((ticker.price * 0.998).toFixed(rules.pair_decimals)),
            take_profit: Number((ticker.price * 1.0005).toFixed(rules.pair_decimals)),
            entry_date: nowIso,
            exchange_order_id: exchangeOrderId,
            signal_reason: signal.reason,
            confidence: signal.confidence,
            fees: 0,
            raw_response: JSON.stringify(orderResponse),
            opened_by_tick_id: id,
            notes: `LIVE spot market buy · max ${maxQuote} ${choice.quote} · sin leverage/margin/futuros`,
          });
          await entities.Bot.update(bot.id, { trades_count: Number(bot.trades_count || 0) + 1, last_run_at: nowIso, last_order_at: nowIso, last_signal: `opened: ${signal.reason}`, last_error: '' });
          await createAlert(entities, 'Orden LIVE abierta', `${bot.name} abrió ${displayPair(choice.pair)} por ~${volume.cost.toFixed(2)} ${choice.quote}`, 'success');
          openTrades.push(trade);
          results.push({ action: 'opened', tradeId: trade.id, bot: bot.name, pair: displayPair(choice.pair), entryPrice: ticker.price, volume: volume.volume, exchangeOrderId, confidence: signal.confidence, rawResponse: orderResponse });
        } catch (error) {
          await entities.Bot.update(bot.id, { last_run_at: nowIso, last_error: error.message });
          await createAlert(entities, 'Error LIVE crítico', `${bot.name}: ${error.message}`, 'critical');
          results.push({ action: 'error', bot: bot.name, error: error.message });
        }
      }
    }

    const closedTrades = await entities.Trade.filter({ mode: 'live', status: 'closed' }, '-created_date', 100);
    const totalPnl = closedTrades.reduce((sum, trade) => sum + Number(trade.profit_loss || 0), 0);
    await updateSession(entities, liveSession, { last_tick_at: nowIso, total_trades: closedTrades.length + openTrades.length, total_pnl: Number(totalPnl.toFixed(8)), last_error: '' });
    return Response.json({ ok: true, tickId: id, autoMode, runOnce, forceClose, env: { maxQuote: env.maxQuote, intervalMinutes: env.intervalMinutes }, results });
  } catch (error) {
    try {
      const base44 = createClientFromRequest(req);
      const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true }, '-created_date', 1);
      if (sessions[0]?.id) await base44.asServiceRole.entities.BotSession.update(sessions[0].id, { last_error: error.message, last_tick_at: new Date().toISOString() });
      await base44.asServiceRole.entities.Alert.create({ title: 'tradingTick LIVE bloqueado', message: error.message, severity: 'critical', source: 'tradingTick LIVE', is_read: false });
    } catch {}
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});