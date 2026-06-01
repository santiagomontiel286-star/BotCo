import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const SUPPORTED_PAIRS = ['ADAEUR', 'XRPEUR', 'DOTEUR', 'LINKEUR', 'ATOMEUR', 'SOLEUR', 'ETHEUR', 'XBTEUR', 'ADAUSD', 'XRPUSD', 'DOTUSD', 'LINKUSD', 'ATOMUSD', 'SOLUSD', 'ETHUSD', 'XBTUSD'];
const LOW_CAPITAL_ASSETS = ['ADA', 'XRP', 'DOT', 'LINK', 'ATOM', 'SOL', 'ETH', 'BTC'];
const QUOTE_KEYS = { USD: ['ZUSD', 'USD'], EUR: ['ZEUR', 'EUR'] };
const ASSET_KEYS = { XBT: ['XXBT', 'XBT', 'BTC'], ETH: ['XETH', 'ETH'], SOL: ['SOL'], XRP: ['XXRP', 'XRP'], ADA: ['ADA'], DOT: ['DOT'], LINK: ['LINK'], ATOM: ['ATOM'] };
const DISPLAY_PAIRS = { XBTUSD: 'BTC/USD', XBTEUR: 'BTC/EUR', ETHUSD: 'ETH/USD', ETHEUR: 'ETH/EUR', SOLUSD: 'SOL/USD', SOLEUR: 'SOL/EUR', XRPUSD: 'XRP/USD', XRPEUR: 'XRP/EUR', ADAUSD: 'ADA/USD', ADAEUR: 'ADA/EUR', DOTUSD: 'DOT/USD', DOTEUR: 'DOT/EUR', LINKUSD: 'LINK/USD', LINKEUR: 'LINK/EUR', ATOMUSD: 'ATOM/USD', ATOMEUR: 'ATOM/EUR' };
const STRATEGY_RISK = {
  micro_scalp: { timeoutMinutes: 30, takeProfitPct: 0.60, stopLossPct: 0.80 },
  micro_scalp_test: { timeoutMinutes: 30, takeProfitPct: 0.60, stopLossPct: 0.80 },
  ema_cross: { timeoutMinutes: 60, takeProfitPct: 0.45, stopLossPct: 0.65 },
  mean_reversion: { timeoutMinutes: 45, takeProfitPct: 0.35, stopLossPct: 0.55 },
  first_live_trade: { timeoutMinutes: 10, takeProfitPct: 0.25, stopLossPct: 0.35 },
  default: { timeoutMinutes: 45, takeProfitPct: 0.45, stopLossPct: 0.65 }
};
let lastNonce = 0;
const publicCache = new Map();

function nextNonce() { const now = Date.now() * 1000; lastNonce = Math.max(now, lastNonce + 1); return String(lastNonce); }
function tickId() { return `tick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function toBool(value) { return String(value || '').toLowerCase() === 'true'; }
function normalizePair(pair) { const value = String(pair || '').replace('/', '').toUpperCase(); if (value === 'BTCUSD') return 'XBTUSD'; if (value === 'BTCEUR') return 'XBTEUR'; if (value === 'XBT/EUR') return 'XBTEUR'; if (value === 'XBT/USD') return 'XBTUSD'; return value || 'XBTUSD'; }
function displayPair(pair) { const value = normalizePair(pair); return DISPLAY_PAIRS[value] || value; }
function baseAsset(pair) { const value = normalizePair(pair); if (value.startsWith('XBT')) return 'XBT'; if (value.startsWith('ETH')) return 'ETH'; if (value.startsWith('SOL')) return 'SOL'; if (value.startsWith('XRP')) return 'XRP'; if (value.startsWith('ADA')) return 'ADA'; if (value.startsWith('DOT')) return 'DOT'; if (value.startsWith('LINK')) return 'LINK'; if (value.startsWith('ATOM')) return 'ATOM'; return 'ETH'; }
function quoteCurrency(pair) { return normalizePair(pair).endsWith('EUR') ? 'EUR' : 'USD'; }
function getBalanceAmount(balances, currency) { return (QUOTE_KEYS[currency] || [currency]).reduce((sum, key) => sum + Number(balances[key] || 0), 0); }
function getAssetBalance(balances, asset) { return (ASSET_KEYS[asset] || [asset]).reduce((sum, key) => sum + Number(balances[key] || 0), 0); }
function roundDown(value, decimals) { const factor = 10 ** decimals; return Math.floor(value * factor) / factor; }
function pairForAsset(asset, quote) { return asset === 'BTC' ? `XBT${quote}` : `${asset}${quote}`; }
function strategyRisk(strategy) { return STRATEGY_RISK[strategy] || STRATEGY_RISK.default; }

function envConfig() {
  const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'KRAKEN_LIVE_TRADING', 'BOTCO_LIVE_ENABLED'];
  const missing = required.filter(name => !Deno.env.get(name));
  const configuredMax = Number(Deno.env.get('MAX_LIVE_ORDER_QUOTE') || '8');
  const maxQuote = Math.min(configuredMax || 8, 8);
  const maxOpenTrades = Number(Deno.env.get('MAX_OPEN_LIVE_TRADES') || '3');
  const minReservedQuote = Number(Deno.env.get('MIN_RESERVED_QUOTE') || '2');
  const intervalMinutes = Number(Deno.env.get('BOTCO_AUTOTRADE_INTERVAL_MINUTES') || '5');
  return { missing, configuredMax, maxQuote, maxOpenTrades, minReservedQuote, intervalMinutes, krakenLiveTrading: toBool(Deno.env.get('KRAKEN_LIVE_TRADING')), botcoLiveEnabled: toBool(Deno.env.get('BOTCO_LIVE_ENABLED')), ok: missing.length === 0 && toBool(Deno.env.get('KRAKEN_LIVE_TRADING')) && toBool(Deno.env.get('BOTCO_LIVE_ENABLED')) && maxQuote > 0 && maxQuote <= 8 };
}

function assertLiveEnv() {
  const env = envConfig();
  if (env.missing.length) throw new Error(`Faltan variables LIVE: ${env.missing.join(', ')}`);
  if (!env.krakenLiveTrading) throw new Error('KRAKEN_LIVE_TRADING debe ser true');
  if (!env.botcoLiveEnabled) throw new Error('BOTCO_LIVE_ENABLED debe ser true');
  if (!env.maxQuote || env.maxQuote <= 0) throw new Error('MAX_LIVE_ORDER_QUOTE debe ser mayor que 0');
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
  const response = await fetch(`${KRAKEN_API}${path}`, { method: 'POST', headers: { 'API-Key': apiKey, 'API-Sign': await signKraken(path, postData, apiSecret), 'Content-Type': 'application/x-www-form-urlencoded' }, body: postData });
  const json = await response.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return json.result;
}

async function krakenPublic(endpoint, params = {}) {
  const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
  const ttlMs = endpoint === 'AssetPairs' ? 30 * 60 * 1000 : 5000;
  const cached = publicCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ttlMs) return cached.result;
  const url = new URL(`${KRAKEN_API}/0/public/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const json = await response.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  publicCache.set(cacheKey, { at: Date.now(), result: json.result });
  return json.result;
}

async function getCurrentPrice(pair) {
  const result = await krakenPublic('Ticker', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const ticker = result[key];
  const ask = Number(ticker.a?.[0] || 0);
  const bid = Number(ticker.b?.[0] || 0);
  const last = Number(ticker.c?.[0] || 0);
  const volume24h = Number(ticker.v?.[1] || 0);
  if (!last || !ask || !bid || ask <= bid) throw new Error(`Precio/spread inválido para ${displayPair(pair)}`);
  return { price: last, bid, ask, volume24h, spreadPct: ((ask - bid) / last) * 100 };
}

async function getAssetPairRules(pair) {
  const result = await krakenPublic('AssetPairs', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const raw = result[key] || {};
  return { pair: normalizePair(pair), ordermin: Number(raw.ordermin || 0), costmin: Number(raw.costmin || 0), lot_decimals: Number(raw.lot_decimals ?? 8), pair_decimals: Number(raw.pair_decimals ?? 2) };
}

async function getCandles(pair, interval = 5) {
  const result = await krakenPublic('OHLC', { pair: normalizePair(pair), interval });
  const key = Object.keys(result).find(item => item !== 'last');
  return (result[key] || []).slice(-24).map(row => ({ time: Number(row[0]), close: Number(row[4]), volume: Number(row[6]) }));
}

function minRequiredQuote(rules, price) { return Math.max(Number(rules.costmin || 0), Number(rules.ordermin || 0) * price); }
function quoteExposure(openTrades, quote) { return openTrades.filter(trade => quoteCurrency(trade.pair) === quote).reduce((sum, trade) => sum + Number(trade.entry_price || 0) * Number(trade.amount || 0), 0); }

function liquidityCheck(candles, ticker, minQuote) {
  const avgQuoteVolume = candles.slice(-12).reduce((sum, candle) => sum + candle.volume * candle.close, 0) / Math.max(candles.slice(-12).length, 1);
  if (!avgQuoteVolume || avgQuoteVolume < Math.max(minQuote * 2, 15)) return { ok: false, reason: 'volumen insuficiente', avgQuoteVolume };
  if (ticker.volume24h * ticker.price < Math.max(minQuote * 30, 250)) return { ok: false, reason: 'liquidez baja', avgQuoteVolume };
  return { ok: true, reason: 'volumen OK', avgQuoteVolume };
}

async function getBalances() { return krakenPrivate('Balance'); }
async function placeMarketOrder(pair, side, volume) { return krakenPrivate('AddOrder', { pair: normalizePair(pair), type: side, ordertype: 'market', volume: String(volume), validate: 'false' }); }

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

async function inspectTradablePair(pair, balanceQuote, maxQuote) {
  const rules = await getAssetPairRules(pair);
  const ticker = await getCurrentPrice(pair);
  const orderQuote = Math.min(maxQuote, balanceQuote);
  const volume = roundDown(orderQuote / ticker.price, rules.lot_decimals);
  const minCost = minRequiredQuote(rules, ticker.price);
  const missingCapital = Math.max(0, minCost - orderQuote);
  return { pair: normalizePair(pair), selectedPair: displayPair(pair), quote: quoteCurrency(pair), balanceQuote, orderQuote, minVolume: rules.ordermin, minCost: Number(minCost.toFixed(8)), calculatedVolume: volume, calculatedCost: Number((volume * ticker.price).toFixed(8)), missingCapital: Number(missingCapital.toFixed(8)), operable: volume >= rules.ordermin && orderQuote >= minCost && ticker.spreadPct <= 0.25, reason: volume >= rules.ordermin && orderQuote >= minCost ? 'Par operable con capital bajo' : 'capital insuficiente para mínimo Kraken' };
}

async function chooseBestQuoteCurrency(bot, balances, maxQuote) {
  const eurBalance = getBalanceAmount(balances, 'EUR');
  const usdBalance = getBalanceAmount(balances, 'USD');
  const quotes = eurBalance >= usdBalance ? ['EUR', 'USD'] : ['USD', 'EUR'];
  const inspected = [];
  for (const quote of quotes) {
    const balanceQuote = quote === 'EUR' ? eurBalance : usdBalance;
    if (balanceQuote <= 0) continue;
    for (const asset of LOW_CAPITAL_ASSETS) {
      const pair = pairForAsset(asset, quote);
      if (!SUPPORTED_PAIRS.includes(pair)) continue;
      try { inspected.push(await inspectTradablePair(pair, balanceQuote, maxQuote)); }
      catch (error) { inspected.push({ pair, selectedPair: displayPair(pair), quote, balanceQuote, operable: false, reason: `Par no disponible en Kraken: ${error.message}` }); }
    }
  }
  const operable = inspected.filter(item => item.operable).sort((a, b) => a.minCost - b.minCost);
  if (operable.length) return { ...operable[0], reason: `Seleccionado por menor mínimo Kraken ejecutable: ${operable[0].selectedPair}` };
  const closest = inspected.filter(item => Number(item.minCost || 0) > 0).sort((a, b) => a.missingCapital - b.missingCapital)[0];
  if (!closest) return { error: 'LIVE bloqueado: no hay saldo EUR/USD disponible', reason: 'No hay saldo EUR/USD disponible', attemptedPairs: inspected };
  return { error: `LIVE bloqueado: capital insuficiente para mínimo Kraken. Faltan ${closest.missingCapital.toFixed(2)} ${closest.quote}`, reason: `Capital insuficiente para mínimo Kraken en ${closest.selectedPair}`, attemptedPairs: inspected, ...closest };
}

function shouldCloseTrade(trade, ticker, forceClose, bot) {
  if (forceClose) return { close: true, reason: 'Cierre manual solicitado' };
  const entry = Number(trade.entry_price || 0);
  const amount = Number(trade.amount || 0);
  if (!entry || !amount) return { close: false, reason: 'Trade sin entrada o volumen válido' };
  const strategy = bot?.strategy || trade.strategy || 'default';
  const risk = strategyRisk(strategy);
  const pnlPct = ((ticker.price - entry) / entry) * (trade.side === 'buy' ? 1 : -1) * 100;
  const ageMs = Date.now() - new Date(trade.entry_date || trade.created_date).getTime();
  if (pnlPct >= risk.takeProfitPct) return { close: true, reason: `TP ${risk.takeProfitPct}% alcanzado`, pnlPct };
  if (pnlPct <= -risk.stopLossPct) return { close: true, reason: `SL -${risk.stopLossPct}% alcanzado`, pnlPct };
  if (ageMs >= risk.timeoutMinutes * 60 * 1000) return { close: true, reason: `Timeout ${risk.timeoutMinutes} minutos`, pnlPct };
  return { close: false, reason: `Monitoreando hasta ${risk.timeoutMinutes}m`, pnlPct };
}

async function createAlert(entities, title, message, severity = 'info') { try { await entities.Alert.create({ title, message, severity, source: 'tradingTick LIVE', is_read: false }); } catch (error) { console.log(`Alert skipped: ${error.message}`); } }
async function safeBotUpdate(entities, botId, data) { if (!botId) return; try { await entities.Bot.update(botId, data); } catch (error) { console.log(`Bot update skipped: ${error.message}`); } }
async function updateSession(entities, session, data) { if (!session?.id) return; try { await entities.BotSession.update(session.id, data); } catch (error) { console.log(`Session update skipped: ${error.message}`); } }
async function rejectSignal(entities, signal, reason) { if (!signal?.id) return; await entities.Signal.update(signal.id, { status: 'rejected', reason: `${signal.reason || ''} · rejected: ${reason}` }); }
async function markSignal(entities, signal, status, reason) { if (!signal?.id) return; await entities.Signal.update(signal.id, { status, reason: reason ? `${signal.reason || ''} · ${reason}` : signal.reason }); }

async function getFreshSignals(entities) {
  const now = Date.now();
  const signals = await entities.Signal.filter({ status: 'new' }, '-created_date', 120);
  const fresh = [];
  for (const signal of signals) {
    if (signal.expires_at && new Date(signal.expires_at).getTime() <= now) await entities.Signal.update(signal.id, { status: 'expired', reason: `${signal.reason || ''} · expired: superó 3 minutos` });
    else fresh.push(signal);
  }
  return fresh;
}

function rankSignals(signals) {
  return signals.filter(signal => signal.side === 'buy' && Number(signal.score || 0) >= 55 && Number(signal.confidence || 0) >= 0.55).sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || (Number(b.confidence || 0) - Number(a.confidence || 0)) || (new Date(b.created_date) - new Date(a.created_date)));
}

async function riskCheck({ entities, bot, session, pair, balances, env, openTrades, ticker, rules }) {
  if (!env.krakenLiveTrading) return { ok: false, reason: 'KRAKEN_LIVE_TRADING debe ser true' };
  if (!env.botcoLiveEnabled) return { ok: false, reason: 'BOTCO_LIVE_ENABLED debe ser true' };
  if (bot.status !== 'active' || bot.trading_mode !== 'live' || bot.live_enabled !== true) return { ok: false, reason: 'Bot no está LIVE activo' };
  if (!session || session.active !== true || session.mode !== 'live') return { ok: false, reason: 'No hay BotSession LIVE activa' };
  if (openTrades.length >= env.maxOpenTrades) return { ok: false, reason: 'max open trades alcanzado' };
  if (bot.cooldown_until && new Date(bot.cooldown_until).getTime() > Date.now()) return { ok: false, reason: `Cooldown activo hasta ${bot.cooldown_until}` };
  if (openTrades.some(trade => normalizePair(trade.pair) === normalizePair(pair))) return { ok: false, reason: 'ya existe trade abierto del mismo par' };
  if (openTrades.some(trade => trade.bot_name === bot.name && normalizePair(trade.pair) === normalizePair(pair))) return { ok: false, reason: 'ya existe trade abierto del mismo bot/par' };
  if (ticker.spreadPct > 0.25) return { ok: false, reason: 'spread alto' };

  const quote = quoteCurrency(pair);
  const balanceQuote = getBalanceAmount(balances, quote);
  const exposure = quoteExposure(openTrades, quote);
  const totalQuote = balanceQuote + exposure;
  const budgetLeft = Math.max(0, totalQuote * 0.8 - exposure);
  const spendable = Math.max(0, balanceQuote - env.minReservedQuote);
  const maxBotQuote = Math.min(Number(bot.max_order_quote || bot.max_order_usd || env.maxQuote), env.maxQuote);
  const orderQuote = Math.min(maxBotQuote, spendable, budgetLeft);
  const minQuote = minRequiredQuote(rules, ticker.price);
  const volume = roundDown(orderQuote / ticker.price, rules.lot_decimals);
  if (orderQuote <= 0 || balanceQuote < env.minReservedQuote) return { ok: false, reason: 'balance insuficiente', balanceQuote, orderQuote, minQuote };
  if (orderQuote < minQuote || volume < rules.ordermin) return { ok: false, reason: 'capital insuficiente para mínimo Kraken', balanceQuote, orderQuote, minQuote };

  const candles = await getCandles(pair, 5);
  const liquidity = liquidityCheck(candles, ticker, minQuote);
  if (!liquidity.ok) return { ok: false, reason: liquidity.reason, balanceQuote, orderQuote, minQuote };

  const strategy = bot.strategy || 'default';
  const expected = strategyRisk(strategy);
  const estimatedFeesPct = 0.26;
  if (ticker.spreadPct + estimatedFeesPct >= expected.takeProfitPct) return { ok: false, reason: 'fees + spread hacen imposible el TP', balanceQuote, orderQuote, minQuote };

  const recent = await entities.Trade.filter({ bot_name: bot.name, mode: 'live' }, '-created_date', 20);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayLoss = recent.filter(trade => new Date(trade.exit_date || trade.updated_date || trade.created_date).getTime() >= today.getTime()).reduce((sum, trade) => sum + Math.min(0, Number(trade.profit_loss || 0)), 0);
  const dailyLossLimit = Number(bot.daily_loss_limit || 3);
  if (Math.abs(todayLoss) >= dailyLossLimit) return { ok: false, reason: 'daily loss limit alcanzado', balanceQuote, orderQuote, minQuote };
  const consecutiveLosses = recent.filter(trade => trade.status === 'closed').slice(0, 3).filter(trade => Number(trade.profit_loss || 0) < 0).length;
  if (consecutiveLosses >= 3) return { ok: false, reason: '3 pérdidas consecutivas del bot', balanceQuote, orderQuote, minQuote };
  return { ok: true, balanceQuote, orderQuote, minQuote, volume, liquidity };
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

    if (validateOnly) return Response.json({ ok: env.ok, ...env, liveSession: !!liveSession, liveBots: liveBots.length, supportedPairs: SUPPORTED_PAIRS, message: env.ok ? 'Entorno LIVE válido para capital bajo' : 'Entorno LIVE incompleto o bloqueado' });
    assertLiveEnv();
    if (!liveSession) return Response.json({ ok: true, skipped: true, reason: 'No hay BotSession LIVE activa', tickId: id });
    if (!runOnce && !autoMode && !forceClose) return Response.json({ error: 'Payload inválido: usa runOnce, autoMode, forceClose o validateOnly' }, { status: 400 });
    if (!liveBots.length && !forceClose) return Response.json({ ok: true, skipped: true, reason: 'No hay bots LIVE activos', tickId: id });

    const nowIso = new Date().toISOString();
    const results = [];
    let balances = await getBalances();
    let openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);
    let freshSignals = await getFreshSignals(entities);
    const signalStats = { signalsAccepted: 0, signalsRejected: 0, tradesOpened: 0, tradesClosed: 0, reasons: [] };

    for (const trade of openTrades) {
      const pair = normalizePair(trade.pair);
      const bot = bots.find(item => item.name === trade.bot_name);
      try {
        const ticker = await getCurrentPrice(pair);
        let decision = shouldCloseTrade(trade, ticker, forceClose, bot);
        const contrarySignal = freshSignals.find(signal => signal.side === 'sell' && signal.bot_id === bot?.id && normalizePair(signal.pair) === pair);
        if (!decision.close && contrarySignal) decision = { close: true, reason: `Señal contraria del mismo bot: ${contrarySignal.reason}`, signalId: contrarySignal.id };
        if (!decision.close) { results.push({ action: 'monitoring', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), price: ticker.price, pnlPercent: decision.pnlPct, reason: decision.reason }); continue; }
        const closed = await closeTradeMarket(trade, ticker.price);
        const closeOrderId = Array.isArray(closed.response.txid) ? closed.response.txid.join(',') : '';
        if (!closeOrderId) throw new Error('Kraken no devolvió txid de cierre');
        const pnl = (ticker.price - Number(trade.entry_price)) * Number(closed.volume) * (trade.side === 'buy' ? 1 : -1);
        const invested = Number(trade.entry_price) * Number(closed.volume);
        const pnlPct = invested ? (pnl / invested) * 100 : 0;
        await entities.Trade.update(trade.id, { status: 'closed', exit_price: ticker.price, exit_date: nowIso, profit_loss: Number(pnl.toFixed(8)), profit_loss_percent: Number(pnlPct.toFixed(4)), close_order_id: closeOrderId, closed_by_tick_id: id, raw_response: JSON.stringify({ open: trade.raw_response || '', close: closed.response }), notes: `LIVE cerrado: ${decision.reason}` });
        await createAlert(entities, 'Orden LIVE cerrada', `${trade.bot_name} cerró ${displayPair(pair)} · PnL ${pnl.toFixed(6)}`, pnl >= 0 ? 'success' : 'warning');
        if (decision.signalId) await markSignal(entities, { id: decision.signalId }, 'executed', 'executed: cierre por señal contraria');
        if (bot?.id) await safeBotUpdate(entities, bot.id, { last_run_at: nowIso, last_signal: `closed: ${decision.reason}`, last_error: '', cooldown_until: new Date(Date.now() + 60_000).toISOString() });
        signalStats.tradesClosed += 1;
        results.push({ action: 'closed', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), exitPrice: ticker.price, pnl, pnlPercent: pnlPct, closeOrderId, rawResponse: closed.response });
      } catch (error) {
        if (bot?.id) await safeBotUpdate(entities, bot.id, { last_run_at: nowIso, last_error: error.message });
        await createAlert(entities, 'Error cerrando operación LIVE', `${trade.bot_name}: ${error.message}`, 'critical');
        results.push({ action: 'close_error', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), error: error.message });
      }
    }

    openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);
    freshSignals = await getFreshSignals(entities);
    if (!forceClose) {
      for (const signal of rankSignals(freshSignals)) {
        if (openTrades.length >= env.maxOpenTrades) break;
        const bot = liveBots.find(item => item.id === signal.bot_id || item.name === signal.bot_name);
        if (!bot) { await rejectSignal(entities, signal, 'bot no activo o live_enabled false'); signalStats.signalsRejected += 1; signalStats.reasons.push({ signalId: signal.id, bot: signal.bot_name, reason: 'bot no activo o live_enabled false' }); continue; }
        try {
          const pair = normalizePair(signal.pair);
          if (!SUPPORTED_PAIRS.includes(pair)) throw new Error('par no soportado por universo LIVE bajo capital');
          const ticker = await getCurrentPrice(pair);
          const rules = await getAssetPairRules(pair);
          const risk = await riskCheck({ entities, bot, session: liveSession, pair, balances, env, openTrades, ticker, rules });
          if (!risk.ok) throw new Error(risk.reason);

          await markSignal(entities, signal, 'accepted', 'accepted: Risk Guardian OK');
          signalStats.signalsAccepted += 1;
          const orderResponse = await placeMarketOrder(pair, 'buy', risk.volume);
          const exchangeOrderId = Array.isArray(orderResponse.txid) ? orderResponse.txid.join(',') : '';
          if (!exchangeOrderId) throw new Error('Kraken no devolvió txid de apertura');
          const strategy = bot.strategy || signal.strategy || 'default';
          const profile = strategyRisk(strategy);
          const trade = await entities.Trade.create({ exchange: 'kraken', mode: 'live', bot_name: bot.name, pair: displayPair(pair), side: 'buy', entry_price: ticker.price, amount: risk.volume, status: 'open', stop_loss: Number((ticker.price * (1 - profile.stopLossPct / 100)).toFixed(rules.pair_decimals)), take_profit: Number((ticker.price * (1 + profile.takeProfitPct / 100)).toFixed(rules.pair_decimals)), entry_date: nowIso, exchange_order_id: exchangeOrderId, signal_reason: signal.reason, confidence: signal.confidence, fees: 0, raw_response: JSON.stringify({ orderResponse, signal, risk: { orderQuote: risk.orderQuote, minQuote: risk.minQuote, balanceQuote: risk.balanceQuote, avgQuoteVolume5m: risk.liquidity?.avgQuoteVolume } }), opened_by_tick_id: id, notes: `LIVE spot market buy desde Signal Bus · usado ${risk.orderQuote.toFixed(2)} ${quoteCurrency(pair)} · max ${env.maxOpenTrades} posiciones` });
          await markSignal(entities, signal, 'executed', `executed: trade ${trade.id}`);
          await safeBotUpdate(entities, bot.id, { trades_count: Number(bot.trades_count || 0) + 1, last_run_at: nowIso, last_order_at: nowIso, last_signal: `opened from signal: ${signal.reason}`, last_error: '' });
          await createAlert(entities, 'Orden LIVE abierta por señal', `${bot.name} abrió ${displayPair(pair)} por ~${risk.orderQuote.toFixed(2)} ${quoteCurrency(pair)}`, 'success');
          openTrades.push(trade);
          balances = await getBalances();
          signalStats.tradesOpened += 1;
          results.push({ action: 'opened', source: 'Signal Bus', signalId: signal.id, tradeId: trade.id, bot: bot.name, selectedPair: displayPair(pair), score: signal.score, confidence: signal.confidence, entryPrice: ticker.price, quoteUsed: risk.orderQuote, minRequiredQuote: risk.minQuote, availableQuote: risk.balanceQuote, maxOpenTrades: env.maxOpenTrades, openTrades: openTrades.length, exchangeOrderId, reason: signal.reason, rawResponse: orderResponse });
        } catch (error) {
          await rejectSignal(entities, signal, error.message);
          if (bot?.id) await safeBotUpdate(entities, bot.id, { last_run_at: nowIso, last_signal: `signal rejected: ${error.message}`, last_error: '' });
          signalStats.signalsRejected += 1;
          signalStats.reasons.push({ signalId: signal.id, bot: signal.bot_name, pair: signal.pair, reason: error.message });
          results.push({ action: 'signal_rejected', signalId: signal.id, bot: signal.bot_name, pair: signal.pair, reason: error.message });
        }
      }
    }

    const closedTrades = await entities.Trade.filter({ mode: 'live', status: 'closed' }, '-created_date', 100);
    const totalPnl = closedTrades.reduce((sum, trade) => sum + Number(trade.profit_loss || 0), 0);
    await updateSession(entities, liveSession, { last_tick_at: nowIso, total_trades: closedTrades.length + openTrades.length, total_pnl: Number(totalPnl.toFixed(8)), last_error: '' });
    return Response.json({ ok: true, tickId: id, executionTick: nowIso, autoMode, runOnce, forceClose, env: { maxQuote: env.maxQuote, maxOpenTrades: env.maxOpenTrades, minReservedQuote: env.minReservedQuote, intervalMinutes: env.intervalMinutes }, scannedPairs: SUPPORTED_PAIRS, openTrades: openTrades.length, signalsAccepted: signalStats.signalsAccepted, signalsRejected: signalStats.signalsRejected, tradesOpened: signalStats.tradesOpened, tradesClosed: signalStats.tradesClosed, reasons: signalStats.reasons, results });
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