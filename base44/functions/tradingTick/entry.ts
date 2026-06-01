import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const LIVE_TRADING = Deno.env.get('KRAKEN_LIVE_TRADING') === 'true';
const ALLOW_FIRST_LIVE_TRADE = Deno.env.get('ALLOW_FIRST_LIVE_TRADE') === 'true';
const GLOBAL_MAX_ORDER_USD = Number(Deno.env.get('MAX_ORDER_USD') || '10');

let lastNonce = 0;

function nextNonce() {
  const now = Date.now() * 1000;
  lastNonce = Math.max(now, lastNonce + 1);
  return String(lastNonce);
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
    headers: {
      'API-Key': apiKey,
      'API-Sign': await signKraken(path, postData, apiSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  });
  const json = await response.json();
  if (json.error?.length) {
    const message = json.error.join(', ');
    if (message.toLowerCase().includes('volume')) throw new Error('Volumen inferior al mínimo de Kraken para este par');
    throw new Error(message);
  }
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
  const value = String(pair || 'XBTUSD').replace('/', '').toUpperCase();
  if (value === 'BTCUSD') return 'XBTUSD';
  if (value === 'BTCEUR') return 'XBTEUR';
  return value;
}

function displayPair(pair) {
  const value = normalizePair(pair);
  if (value === 'XBTUSD') return 'BTC/USD';
  if (value === 'XBTEUR') return 'BTC/EUR';
  if (value === 'ETHUSD') return 'ETH/USD';
  if (value === 'ETHEUR') return 'ETH/EUR';
  return value;
}

async function getCurrentPrice(pair) {
  const result = await krakenPublic('Ticker', { pair });
  const key = Object.keys(result)[0];
  const ticker = result[key];
  const ask = Number(ticker.a?.[0] || 0);
  const bid = Number(ticker.b?.[0] || 0);
  const last = Number(ticker.c?.[0] || 0);
  if (!last || !ask || !bid || ask <= bid) throw new Error('Precio/spread inválido en Kraken');
  return { price: last, bid, ask, spreadPct: ((ask - bid) / last) * 100 };
}

async function getCandles(pair, interval = 1) {
  const result = await krakenPublic('OHLC', { pair, interval });
  const key = Object.keys(result).find(k => k !== 'last');
  return (result[key] || []).map(row => ({ close: Number(row[4]), time: Number(row[0]) }));
}

async function getUsdBalance() {
  const balance = await krakenPrivate('Balance');
  return Number(balance.ZUSD || balance.USD || 0);
}

function calcVolume(maxOrderUsd, currentPrice) {
  return Math.floor((maxOrderUsd / currentPrice) * 100000000) / 100000000;
}

async function placeMarketOrder(pair, side, volume) {
  return krakenPrivate('AddOrder', {
    pair,
    type: side,
    ordertype: 'market',
    volume: volume.toFixed(8),
  });
}

async function closePosition(trade) {
  return placeMarketOrder(normalizePair(trade.pair), trade.side === 'buy' ? 'sell' : 'buy', Number(trade.amount || 0));
}

function shouldCloseTrade(trade, currentPrice, forceClose) {
  if (forceClose) return { close: true, reason: 'Cierre manual solicitado por usuario' };
  const entry = Number(trade.entry_price || 0);
  if (!entry) return { close: false, reason: 'Sin precio de entrada válido' };
  const isBuy = trade.side === 'buy';
  const pnlPct = ((currentPrice - entry) / entry) * (isBuy ? 1 : -1) * 100;
  const ageMs = Date.now() - new Date(trade.entry_date || trade.created_date).getTime();
  if (pnlPct >= 0.10) return { close: true, reason: 'Objetivo +0.10% alcanzado', pnlPct };
  if (pnlPct <= -0.20) return { close: true, reason: 'Stop -0.20% alcanzado', pnlPct };
  if (ageMs >= 10 * 60 * 1000) return { close: true, reason: 'Cierre por tiempo máximo de 10 minutos', pnlPct };
  if (trade.stop_loss && currentPrice <= Number(trade.stop_loss)) return { close: true, reason: 'Precio bajo stop calculado', pnlPct };
  return { close: false, reason: 'Operación abierta en seguimiento', pnlPct };
}

async function updateBotError(base44, bot, message) {
  await base44.entities.Bot.update(bot.id, {
    last_run_at: new Date().toISOString(),
    last_error: message,
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const forceClose = payload.forceClose === true;
    const firstLiveTrade = payload.firstLiveTrade === true;
    const validateOnly = payload.validateOnly === true;

    const bots = await base44.entities.Bot.list();
    const liveBots = bots.filter(bot =>
      bot.status === 'active' &&
      (bot.exchange || 'kraken') === 'kraken' &&
      bot.trading_mode === 'live' &&
      bot.live_enabled === true
    );

    if (validateOnly) {
      return Response.json({ liveTradingEnv: LIVE_TRADING, allowFirstLiveTrade: ALLOW_FIRST_LIVE_TRADE, maxOrderUsd: GLOBAL_MAX_ORDER_USD, liveBots: liveBots.length });
    }

    if (!LIVE_TRADING) return Response.json({ error: 'KRAKEN_LIVE_TRADING debe ser true para operar LIVE' }, { status: 403 });
    if (firstLiveTrade && !ALLOW_FIRST_LIVE_TRADE) return Response.json({ error: 'ALLOW_FIRST_LIVE_TRADE debe ser true para la primera operación real' }, { status: 403 });
    if (GLOBAL_MAX_ORDER_USD > 10) return Response.json({ error: 'MAX_ORDER_USD no puede superar 10 durante la prueba inicial' }, { status: 403 });
    if (!liveBots.length && !forceClose) return Response.json({ error: 'No hay bots activos LIVE con live_enabled=true' }, { status: 400 });

    const openLiveTrades = await base44.entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 20);
    const results = [];

    if (openLiveTrades.length > 0) {
      for (const trade of openLiveTrades) {
        const pair = normalizePair(trade.pair);
        const bot = bots.find(item => item.name === trade.bot_name) || liveBots[0];
        const ticker = await getCurrentPrice(pair);
        const closeDecision = shouldCloseTrade(trade, ticker.price, forceClose);

        if (!closeDecision.close) {
          results.push({ action: 'monitoring', tradeId: trade.id, pair: displayPair(pair), price: ticker.price, pnlPercent: closeDecision.pnlPct, reason: closeDecision.reason });
          continue;
        }

        const closeResponse = await closePosition(trade);
        const closeOrderId = Array.isArray(closeResponse.txid) ? closeResponse.txid.join(',') : '';
        const pnl = trade.side === 'buy'
          ? (ticker.price - Number(trade.entry_price)) * Number(trade.amount)
          : (Number(trade.entry_price) - ticker.price) * Number(trade.amount);
        const pnlPct = ((pnl / (Number(trade.entry_price) * Number(trade.amount))) * 100) || 0;

        await base44.entities.Trade.update(trade.id, {
          status: 'closed',
          exit_price: ticker.price,
          exit_date: new Date().toISOString(),
          profit_loss: Number(pnl.toFixed(6)),
          profit_loss_percent: Number(pnlPct.toFixed(4)),
          close_order_id: closeOrderId,
          fees: Number(trade.fees || 0),
          raw_response: JSON.stringify({ open: trade.raw_response || '', close: closeResponse }),
          notes: `LIVE cerrado: ${closeDecision.reason}`,
        });

        if (bot?.id) {
          await base44.entities.Bot.update(bot.id, {
            last_run_at: new Date().toISOString(),
            last_signal: `closed: ${closeDecision.reason}`,
            last_error: '',
          });
        }

        results.push({ action: 'closed', tradeId: trade.id, pair: displayPair(pair), exitPrice: ticker.price, pnl, pnlPercent: pnlPct, closeOrderId, rawResponse: closeResponse });
      }
      return Response.json({ liveTradingEnv: LIVE_TRADING, maxOrderUsd: GLOBAL_MAX_ORDER_USD, results });
    }

    if (forceClose) return Response.json({ message: 'No hay operaciones LIVE abiertas para cerrar', results: [] });
    if (!firstLiveTrade) return Response.json({ message: 'Sin acción LIVE: usa firstLiveTrade=true para abrir la primera operación real', results: [] });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const recentLiveTrades = await base44.entities.Trade.filter({ mode: 'live' }, '-created_date', 20);
    const firstTradeAlreadyUsedToday = recentLiveTrades.some(trade =>
      (trade.signal_reason || '').includes('first_live_trade') &&
      new Date(trade.entry_date || trade.created_date).getTime() >= todayStart.getTime()
    );
    if (firstLiveTrade && firstTradeAlreadyUsedToday) {
      return Response.json({ error: 'La primera operación LIVE de prueba ya fue usada hoy' }, { status: 409 });
    }

    const bot = liveBots[0];
    const pair = normalizePair(bot.pairs?.[0] || 'XBTUSD');

    try {
      if (bot.strategy !== 'first_live_trade') throw new Error('El bot debe usar strategy=first_live_trade');
      const orderUsd = Math.min(Number(bot.max_order_usd || 10), GLOBAL_MAX_ORDER_USD, 10);
      if (orderUsd <= 0 || orderUsd > 10) throw new Error('max_order_usd debe estar entre 0 y 10 para esta prueba');

      const ticker = await getCurrentPrice(pair);
      await getCandles(pair, 1);
      const usdBalance = await getUsdBalance();
      if (usdBalance < orderUsd) throw new Error(`Balance USD insuficiente en Kraken: ${usdBalance.toFixed(2)} USD`);

      const volume = calcVolume(orderUsd, ticker.price);
      if (volume <= 0) throw new Error('Volumen inferior al mínimo de Kraken para este par');

      const orderResponse = await placeMarketOrder(pair, 'buy', volume);
      const exchangeOrderId = Array.isArray(orderResponse.txid) ? orderResponse.txid.join(',') : '';
      const stopLoss = Number((ticker.price * 0.998).toFixed(2));
      const takeProfit = Number((ticker.price * 1.001).toFixed(2));

      const trade = await base44.entities.Trade.create({
        exchange: 'kraken',
        mode: 'live',
        bot_name: bot.name,
        pair: displayPair(pair),
        side: 'buy',
        entry_price: ticker.price,
        amount: volume,
        status: 'open',
        stop_loss: stopLoss,
        take_profit: takeProfit,
        entry_date: new Date().toISOString(),
        exchange_order_id: exchangeOrderId,
        signal_reason: 'first_live_trade: validación ciclo real completo',
        confidence: 1,
        fees: 0,
        raw_response: JSON.stringify(orderResponse),
        notes: `LIVE first_live_trade · orden máxima ${orderUsd} USD · sin leverage/margin/futuros`,
      });

      await base44.entities.Bot.update(bot.id, {
        trades_count: Number(bot.trades_count || 0) + 1,
        last_run_at: new Date().toISOString(),
        last_signal: `opened first_live_trade @ ${ticker.price}`,
        last_error: '',
      });

      return Response.json({
        liveTradingEnv: LIVE_TRADING,
        allowFirstLiveTrade: ALLOW_FIRST_LIVE_TRADE,
        maxOrderUsd: GLOBAL_MAX_ORDER_USD,
        results: [{ action: 'opened', tradeId: trade.id, bot: bot.name, pair: displayPair(pair), entryPrice: ticker.price, volume, exchangeOrderId, rawResponse: orderResponse }],
      });
    } catch (error) {
      await updateBotError(base44, bot, error.message);
      return Response.json({ error: error.message, results: [{ bot: bot.name, pair: displayPair(pair), action: 'error', error: error.message }] }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});