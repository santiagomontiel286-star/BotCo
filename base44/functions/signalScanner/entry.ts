import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const PAIRS = ['XBTEUR', 'XBTUSD', 'ETHEUR', 'ETHUSD', 'SOLEUR', 'SOLUSD', 'XRPEUR', 'XRPUSD', 'ADAEUR', 'ADAUSD'];
const QUOTE_KEYS = { USD: ['ZUSD', 'USD'], EUR: ['ZEUR', 'EUR'] };
let lastNonce = 0;
const publicCache = new Map();

function toBool(value) { return String(value || '').toLowerCase() === 'true'; }
function nextNonce() { const now = Date.now() * 1000; lastNonce = Math.max(now, lastNonce + 1); return String(lastNonce); }
function normalizePair(pair) { const value = String(pair || '').replace('/', '').toUpperCase(); if (value === 'BTCUSD') return 'XBTUSD'; if (value === 'BTCEUR') return 'XBTEUR'; return value; }
function quoteCurrency(pair) { return normalizePair(pair).endsWith('EUR') ? 'EUR' : 'USD'; }
function getBalanceAmount(balances, currency) { return (QUOTE_KEYS[currency] || [currency]).reduce((sum, key) => sum + Number(balances[key] || 0), 0); }
function minScore(profile) { return profile === 'agresivo' ? 30 : profile === 'balanceado' ? 25 : 20; }
function ema(values, period) { if (values.length < period) return values[values.length - 1] || 0; const k = 2 / (period + 1); return values.slice(1).reduce((prev, value) => value * k + prev * (1 - k), values[0]); }
function rsi(values, period = 14) { if (values.length <= period) return 50; const slice = values.slice(-period - 1); let gains = 0; let losses = 0; for (let i = 1; i < slice.length; i++) { const diff = slice[i] - slice[i - 1]; if (diff >= 0) gains += diff; else losses += Math.abs(diff); } if (losses === 0) return 100; const rs = gains / losses; return 100 - (100 / (1 + rs)); }

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
  const ttlMs = endpoint === 'AssetPairs' ? 30 * 60 * 1000 : 12000;
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
  const price = Number(ticker.c?.[0] || 0);
  return { price, bid, ask, spreadPct: price ? ((ask - bid) / price) * 100 : 999 };
}

async function getAssetPairRules(pair) {
  const result = await krakenPublic('AssetPairs', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const raw = result[key] || {};
  return { ordermin: Number(raw.ordermin || 0), costmin: Number(raw.costmin || 0), lot_decimals: Number(raw.lot_decimals ?? 8) };
}

async function getCandles(pair, interval = 1) {
  const result = await krakenPublic('OHLC', { pair: normalizePair(pair), interval });
  const key = Object.keys(result).find(item => item !== 'last');
  return (result[key] || []).slice(-60).map(row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[6]) }));
}

async function chooseTradablePair(balances, maxQuote) {
  const rejected = [];
  for (const pair of PAIRS) {
    try {
      const quote = quoteCurrency(pair);
      const balanceQuote = getBalanceAmount(balances, quote);
      if (balanceQuote <= 0) { rejected.push({ pair, reason: `Sin saldo ${quote}` }); continue; }
      const ticker = await getCurrentPrice(pair);
      const rules = await getAssetPairRules(pair);
      const orderQuote = Math.min(maxQuote, balanceQuote);
      const volume = orderQuote / ticker.price;
      const minCost = Math.max(rules.costmin || 0, (rules.ordermin || 0) * ticker.price);
      if (orderQuote < minCost || volume < rules.ordermin) { rejected.push({ pair, reason: `capital insuficiente para par: mínimo ${minCost.toFixed(4)} ${quote}` }); continue; }
      return { pair, ticker, rules, orderQuote, balanceQuote, rejected };
    } catch (error) {
      rejected.push({ pair, reason: error.message });
    }
  }
  return { rejected };
}

function evaluateBot(bot, candles, ticker) {
  const closes = candles.map(c => c.close);
  const recent = candles.slice(-3);
  const strategy = bot.strategy || bot.type || 'ema_cross';
  const ema9 = ema(closes.slice(-30), 9);
  const ema21 = ema(closes.slice(-60), 21);
  const ema9Prev = ema(closes.slice(-31, -1), 9);
  const currentRsi = rsi(closes);
  const fallingFast = recent.length === 3 && ((recent[0].close - recent[2].close) / recent[0].close) * 100 > 0.3;
  const volumeAvg = candles.slice(-12).reduce((s, c) => s + c.volume, 0) / Math.max(candles.slice(-12).length, 1);
  const volumeGrowing = recent.length === 3 && recent[2].volume > recent[1].volume && recent[1].volume > recent[0].volume;
  const recovering = recent.length === 3 && recent[2].close > recent[1].close && recent[1].close >= recent[0].close;
  const high5 = Math.max(...candles.slice(-6, -1).map(c => c.high));
  const high12 = Math.max(...candles.slice(-13, -1).map(c => c.high));
  const return5m = closes.length > 5 ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;

  if (bot.type === 'risk_guardian') return { side: 'hold', confidence: 0.7, score: 35, reason: 'risk_ok: scanner operativo, control de riesgo en execution engine' };
  if (strategy.includes('mean') || bot.type === 'mean_reversion') {
    if (currentRsi < 42 && !fallingFast) return { side: 'buy', confidence: 0.58, score: 32, reason: `mean_reversion BUY: RSI ${currentRsi.toFixed(1)} sin caída rápida` };
    if (currentRsi > 58) return { side: 'sell', confidence: 0.57, score: 28, reason: `mean_reversion SELL: RSI ${currentRsi.toFixed(1)}` };
  }
  if (strategy.includes('momentum')) {
    if (ticker.price > high5 || return5m > 0.15) return { side: 'buy', confidence: 0.59, score: 34, reason: `momentum BUY: retorno 5m ${return5m.toFixed(3)}%` };
    if (return5m < -0.10) return { side: 'sell', confidence: 0.56, score: 26, reason: 'momentum SELL: momentum debilitado' };
  }
  if (strategy.includes('breakout')) {
    if (ticker.price > high12 && recent[2]?.volume > volumeAvg) return { side: 'buy', confidence: 0.6, score: 36, reason: 'breakout BUY: rompe máximo 12 velas con volumen' };
    if (ticker.price < high12) return { side: 'sell', confidence: 0.55, score: 24, reason: 'breakout SELL: vuelve al rango' };
  }
  if (bot.type === 'ai_sentiment') {
    if (recovering || volumeGrowing) return { side: 'buy', confidence: 0.56, score: 30, reason: 'ai_sentiment momentum BUY: recuperación/volumen creciente' };
    return { side: 'hold', confidence: 0.45, score: 12, reason: 'ai_sentiment HOLD: datos insuficientes' };
  }
  if (ema9 > ema21 && ema9 > ema9Prev) return { side: 'buy', confidence: 0.58, score: 33, reason: `trend_following BUY: EMA9 ${ema9.toFixed(4)} > EMA21 ${ema21.toFixed(4)} y pendiente positiva` };
  if (ema9 < ema21) return { side: 'sell', confidence: 0.56, score: 26, reason: `trend_following SELL: EMA9 ${ema9.toFixed(4)} < EMA21 ${ema21.toFixed(4)}` };
  return { side: 'hold', confidence: 0.4, score: 10, reason: 'Sin señal activa' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const autoMode = payload.autoMode === true;
    const user = await base44.auth.me().catch(() => null);
    if (!autoMode && !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const entities = base44.asServiceRole.entities;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000).toISOString();
    const maxQuote = Number(Deno.env.get('MAX_LIVE_ORDER_QUOTE') || '10');
    const liveAllowed = toBool(Deno.env.get('KRAKEN_LIVE_TRADING')) && toBool(Deno.env.get('BOTCO_LIVE_ENABLED'));
    const sessions = await entities.BotSession.filter({ active: true }, '-created_date', 5);
    const liveSession = sessions.find(session => session.mode === 'live');
    const bots = (await entities.Bot.list()).filter(bot => bot.status === 'active' && bot.trading_mode === 'live' && bot.live_enabled === true && (bot.exchange || 'kraken') === 'kraken');
    const balances = liveAllowed ? await krakenPrivate('Balance') : {};
    const created = [];
    const rejected = [];

    if (!liveAllowed) rejected.push({ reason: 'KRAKEN_LIVE_TRADING/BOTCO_LIVE_ENABLED false' });
    if (!liveSession) rejected.push({ reason: 'No hay BotSession LIVE activa' });

    for (const bot of bots) {
      const choice = liveAllowed ? await chooseTradablePair(balances, Math.min(Number(bot.max_order_quote || bot.max_order_usd || maxQuote), maxQuote)) : { rejected: [] };
      if (!choice.pair) {
        const reason = (choice.rejected || []).map(item => `${item.pair}: ${item.reason}`).join(' | ') || 'Sin par operable';
        const signal = await entities.Signal.create({ bot_name: bot.name, bot_id: bot.id, strategy: bot.strategy || bot.type, exchange: 'kraken', pair: bot.pairs?.[0] || 'AUTO', side: 'hold', confidence: 0, score: 0, reason, price: 0, timeframe: '1m', status: 'rejected', expires_at: expiresAt, raw_data: JSON.stringify({ rejectedPairs: choice.rejected || [] }) });
        rejected.push({ bot: bot.name, reason });
        created.push(signal);
        continue;
      }
      const candles = await getCandles(choice.pair, 1);
      const decision = evaluateBot(bot, candles, choice.ticker);
      const requiredScore = minScore(liveSession?.risk_profile);
      const status = decision.side === 'hold' || decision.score < requiredScore ? 'rejected' : 'new';
      const signal = await entities.Signal.create({ bot_name: bot.name, bot_id: bot.id, strategy: bot.strategy || bot.type, exchange: 'kraken', pair: choice.pair, side: decision.side, confidence: decision.confidence, score: decision.score, reason: status === 'new' ? decision.reason : `${decision.reason} · score ${decision.score}/${requiredScore}`, price: choice.ticker.price, timeframe: '1m', status, expires_at: expiresAt, raw_data: JSON.stringify({ spreadPct: choice.ticker.spreadPct, orderQuote: choice.orderQuote, balanceQuote: choice.balanceQuote, rejectedPairs: choice.rejected }) });
      created.push(signal);
      if (status === 'rejected') rejected.push({ bot: bot.name, pair: choice.pair, reason: signal.reason });
    }

    if (liveSession?.id) await entities.BotSession.update(liveSession.id, { last_tick_at: now.toISOString(), last_error: '' });
    return Response.json({ ok: true, scannerTick: now.toISOString(), scannedBots: bots.length, signalsCreated: created.length, signalsRejected: rejected.length, reasons: rejected });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});