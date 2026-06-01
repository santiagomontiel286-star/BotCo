import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const LIVE_TRADING = Deno.env.get('KRAKEN_LIVE_TRADING') === 'true';
const GLOBAL_MAX_ORDER_USD = Number(Deno.env.get('MAX_ORDER_USD') || '25');

let lastNonce = 0;

function nextNonce() {
  const now = Date.now() * 1000;
  lastNonce = Math.max(now, lastNonce + 1);
  return String(lastNonce);
}

async function signKraken(path, postData, secret) {
  const nonce = new URLSearchParams(postData).get('nonce') || '';
  const secretBuffer = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const sha256Hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce + postData));
  const message = new Uint8Array([
    ...new TextEncoder().encode(path),
    ...new Uint8Array(sha256Hash),
  ]);
  const key = await crypto.subtle.importKey('raw', secretBuffer, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, message);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function krakenPrivate(path, params = {}) {
  const apiKey = Deno.env.get('KRAKEN_API_KEY');
  const apiSecret = Deno.env.get('KRAKEN_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Faltan KRAKEN_API_KEY o KRAKEN_API_SECRET');

  const body = new URLSearchParams();
  body.set('nonce', nextNonce());
  for (const [key, value] of Object.entries(params)) body.set(key, String(value));

  const postData = body.toString();
  const signature = await signKraken(path, postData, apiSecret);
  const res = await fetch(`${KRAKEN_API}${path}`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  });
  const json = await res.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return json.result;
}

async function krakenPublic(path, params = {}) {
  const url = new URL(`${KRAKEN_API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const res = await fetch(url);
  const json = await res.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return json.result;
}

function ema(values, period) {
  const k = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i++) current = values[i] * k + current * (1 - k);
  return current;
}

function getSignal(closes, strategy = 'ema_cross') {
  if (closes.length < 60) return { action: 'hold', confidence: 0, reason: 'No hay suficientes velas' };
  const previous = closes.slice(0, -1);
  const price = closes[closes.length - 1];

  if (strategy === 'mean_reversion') {
    const recent = closes.slice(-20);
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const deviation = (price - average) / average;
    if (deviation < -0.012) return { action: 'buy', confidence: 0.62, reason: 'Reversión a la media: precio bajo media 20', price };
    if (deviation > 0.012) return { action: 'sell', confidence: 0.62, reason: 'Reversión a la media: precio sobre media 20', price };
    return { action: 'hold', confidence: 0.5, reason: 'Sin desviación suficiente de la media', price };
  }

  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  const prevFast = ema(previous, 20);
  const prevSlow = ema(previous, 50);

  if (prevFast <= prevSlow && fast > slow) return { action: 'buy', confidence: 0.68, reason: 'Cruce alcista EMA20 sobre EMA50', price };
  if (prevFast >= prevSlow && fast < slow) return { action: 'sell', confidence: 0.68, reason: 'Cruce bajista EMA20 bajo EMA50', price };
  return { action: 'hold', confidence: 0.5, reason: 'Sin cruce confirmado', price };
}

async function getCandles(pair, interval) {
  const data = await krakenPublic('/0/public/OHLC', { pair, interval });
  const key = Object.keys(data).find(k => k !== 'last');
  const rows = data[key] || [];
  return rows.map(c => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[6]),
  }));
}

function getQuoteCurrency(pair) {
  if (pair.endsWith('EUR')) return 'EUR';
  return 'USD';
}

async function getQuoteBalance(pair) {
  const balance = await krakenPrivate('/0/private/Balance');
  const quote = getQuoteCurrency(pair);
  if (quote === 'EUR') return Number(balance.ZEUR || balance.EUR || 0);
  return Number(balance.ZUSD || balance.USD || 0);
}

function calcVolume(orderValue, price) {
  return Math.floor((orderValue / price) * 100000000) / 100000000;
}

async function placeKrakenMarketOrder(params) {
  return krakenPrivate('/0/private/AddOrder', {
    pair: params.pair,
    type: params.side,
    ordertype: 'market',
    volume: params.volume,
  });
}

async function getTodayLoss(base44, bot, mode) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const trades = await base44.entities.Trade.filter({ bot_name: bot.name, mode, status: 'closed' }, '-created_date', 100);
  return trades
    .filter(trade => new Date(trade.exit_date || trade.updated_date || trade.created_date) >= startOfDay)
    .reduce((sum, trade) => sum + Math.min(0, Number(trade.profit_loss || 0)), 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const bots = await base44.entities.Bot.list();
    const activeBots = bots.filter(bot => bot.status === 'active' && (bot.exchange || 'kraken') === 'kraken');
    const results = [];

    for (const bot of activeBots) {
      const pair = bot.pairs?.[0] || 'XBTUSD';
      const interval = Number(bot.timeframe || 15);
      const mode = bot.trading_mode || 'demo';

      try {
        const candles = await getCandles(pair, interval);
        const closes = candles.map(c => c.close);
        const signal = getSignal(closes, bot.strategy || 'ema_cross');

        if (signal.action === 'hold') {
          await base44.entities.Bot.update(bot.id, {
            last_run_at: new Date().toISOString(),
            last_signal: signal.reason,
            last_error: '',
          });
          results.push({ bot: bot.name, pair, mode, action: 'hold', reason: signal.reason });
          continue;
        }

        const price = signal.price || closes[closes.length - 1];
        const maxBotOrderUsd = Number(bot.max_order_usd || GLOBAL_MAX_ORDER_USD);
        const orderUsd = Math.min(maxBotOrderUsd, GLOBAL_MAX_ORDER_USD);
        if (orderUsd <= 0) throw new Error('max_order_usd inválido');

        const todayLoss = await getTodayLoss(base44, bot, mode);
        const dailyLossLimit = Number(bot.daily_loss_limit || 0);
        if (dailyLossLimit > 0 && Math.abs(todayLoss) >= dailyLossLimit) {
          throw new Error(`Límite de pérdida diaria alcanzado (${todayLoss.toFixed(2)})`);
        }

        let quoteBalance = orderUsd;
        if (mode === 'live') {
          if (!LIVE_TRADING) throw new Error('KRAKEN_LIVE_TRADING no está activado');
          if (bot.live_enabled !== true) throw new Error('El bot no tiene live_enabled=true');
          quoteBalance = await getQuoteBalance(pair);
          if (quoteBalance < orderUsd) throw new Error(`Balance ${getQuoteCurrency(pair)} insuficiente`);
        }

        const volume = calcVolume(orderUsd, price);
        if (volume <= 0) throw new Error('Volumen calculado inválido');

        let exchangeOrderId = '';
        let rawResponse = null;

        if (mode === 'live') {
          const order = await placeKrakenMarketOrder({ pair, side: signal.action, volume });
          rawResponse = order;
          exchangeOrderId = Array.isArray(order.txid) ? order.txid.join(',') : '';
        }

        const tradeData = {
          bot_name: bot.name,
          exchange: 'kraken',
          mode,
          pair,
          side: signal.action,
          entry_price: price,
          amount: volume,
          status: mode === 'live' ? 'open' : 'closed',
          entry_date: new Date().toISOString(),
          exchange_order_id: exchangeOrderId,
          signal_reason: signal.reason,
          confidence: signal.confidence,
          fees: 0,
          raw_response: rawResponse ? JSON.stringify(rawResponse) : '',
          notes: `${mode.toUpperCase()} | ${signal.reason}`,
        };

        if (mode === 'demo') {
          tradeData.exit_price = price;
          tradeData.exit_date = new Date().toISOString();
          tradeData.profit_loss = 0;
          tradeData.profit_loss_percent = 0;
        }

        await base44.entities.Trade.create(tradeData);
        await base44.entities.Bot.update(bot.id, {
          trades_count: Number(bot.trades_count || 0) + 1,
          last_run_at: new Date().toISOString(),
          last_signal: `${signal.action}: ${signal.reason}`,
          last_error: '',
        });

        results.push({ bot: bot.name, pair, mode, action: signal.action, price, volume, orderUsd, live: mode === 'live', exchangeOrderId });
      } catch (error) {
        await base44.entities.Bot.update(bot.id, {
          last_run_at: new Date().toISOString(),
          last_error: error.message,
        });
        results.push({ bot: bot.name, pair, mode, action: 'error', error: error.message });
      }
    }

    return Response.json({ liveTradingEnv: LIVE_TRADING, maxOrderUsd: GLOBAL_MAX_ORDER_USD, activeBots: activeBots.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});