import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const EUR_PAIRS = ['ADAEUR', 'XRPEUR', 'DOTEUR', 'LINKEUR', 'ATOMEUR', 'SOLEUR', 'ETHEUR', 'XBTEUR'];
const USD_PAIRS = ['ADAUSD', 'XRPUSD', 'DOTUSD', 'LINKUSD', 'ATOMUSD', 'SOLUSD', 'ETHUSD', 'XBTUSD'];
const PAIRS = [...EUR_PAIRS, ...USD_PAIRS];
const QUOTE_KEYS = { USD: ['ZUSD', 'USD'], EUR: ['ZEUR', 'EUR'] };
let lastNonce = 0;
const publicCache = new Map();

function toBool(value) { return String(value || '').toLowerCase() === 'true'; }
function nextNonce() { const now = Date.now() * 1000; lastNonce = Math.max(now, lastNonce + 1); return String(lastNonce); }
function normalizePair(pair) { const value = String(pair || '').replace('/', '').toUpperCase(); if (value === 'BTCUSD') return 'XBTUSD'; if (value === 'BTCEUR') return 'XBTEUR'; return value; }
function quoteCurrency(pair) { return normalizePair(pair).endsWith('EUR') ? 'EUR' : 'USD'; }
function getBalanceAmount(balances, currency) { return (QUOTE_KEYS[currency] || [currency]).reduce((sum, key) => sum + Number(balances[key] || 0), 0); }
function roundDown(value, decimals) { const factor = 10 ** decimals; return Math.floor(value * factor) / factor; }
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
  const ttlMs = endpoint === 'AssetPairs' ? 30 * 60 * 1000 : 10000;
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

async function getTicker(pair) {
  const result = await krakenPublic('Ticker', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const ticker = result[key];
  const ask = Number(ticker.a?.[0] || 0);
  const bid = Number(ticker.b?.[0] || 0);
  const price = Number(ticker.c?.[0] || 0);
  const volume24h = Number(ticker.v?.[1] || 0);
  if (!ask || !bid || !price || ask <= bid) throw new Error('ticker inválido');
  return { price, bid, ask, spreadPct: ((ask - bid) / price) * 100, volume24h };
}

async function getAssetPairRules(pair) {
  const result = await krakenPublic('AssetPairs', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const raw = result[key] || {};
  return { ordermin: Number(raw.ordermin || 0), costmin: Number(raw.costmin || 0), lot_decimals: Number(raw.lot_decimals ?? 8), pair_decimals: Number(raw.pair_decimals ?? 2) };
}

async function getCandles(pair, interval = 5) {
  const result = await krakenPublic('OHLC', { pair: normalizePair(pair), interval });
  const key = Object.keys(result).find(item => item !== 'last');
  return (result[key] || []).slice(-72).map(row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[6]) }));
}

function minRequiredQuote(rules, price) {
  return Math.max(Number(rules.costmin || 0), Number(rules.ordermin || 0) * price);
}

function quoteExposure(openTrades, quote) {
  return openTrades.filter(trade => quoteCurrency(trade.pair) === quote).reduce((sum, trade) => sum + Number(trade.entry_price || 0) * Number(trade.amount || 0), 0);
}

function capitalPlan(pair, balances, openTrades, maxQuote, minReserved) {
  const quote = quoteCurrency(pair);
  const balanceQuote = getBalanceAmount(balances, quote);
  const exposure = quoteExposure(openTrades, quote);
  const totalQuote = balanceQuote + exposure;
  const budgetLeft = Math.max(0, totalQuote * 0.8 - exposure);
  const spendable = Math.max(0, balanceQuote - minReserved);
  return { quote, balanceQuote, exposure, orderQuote: Math.min(maxQuote, spendable, budgetLeft) };
}

function evaluateTechnical(bot, candles, ticker) {
  const closes = candles.map(c => c.close);
  const recent = candles.slice(-3);
  const strategy = bot.strategy || bot.type || 'ema_cross';
  const ema9 = ema(closes.slice(-30), 9);
  const ema21 = ema(closes.slice(-60), 21);
  const ema9Prev = ema(closes.slice(-31, -1), 9);
  const currentRsi = rsi(closes);
  const fallingFast = recent.length === 3 && ((recent[0].close - recent[2].close) / recent[0].close) * 100 > 0.35;
  const recovering = recent.length === 3 && recent[2].close > recent[1].close && recent[1].close >= recent[0].close;
  const high12 = Math.max(...candles.slice(-13, -1).map(c => c.high));
  const return25m = closes.length > 5 ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;

  if (bot.type === 'risk_guardian') return { side: 'hold', confidence: 0.7, technicalScore: 20, reason: 'risk_guardian: control delegado al Execution Engine' };
  if (strategy.includes('first_live_trade')) return { side: 'buy', confidence: 0.58, technicalScore: 28, reason: 'first_live_trade: señal manual de prueba conservadora' };
  if (strategy.includes('micro')) {
    if (!fallingFast && currentRsi < 68 && (recovering || return25m > 0.08)) return { side: 'buy', confidence: 0.61, technicalScore: 34, reason: `micro_scalp BUY: RSI ${currentRsi.toFixed(1)}, retorno 25m ${return25m.toFixed(3)}%` };
  }
  if (strategy.includes('mean') || bot.type === 'mean_reversion') {
    if (currentRsi < 42 && !fallingFast) return { side: 'buy', confidence: 0.6, technicalScore: 32, reason: `mean_reversion BUY: RSI ${currentRsi.toFixed(1)} sin caída rápida` };
    if (currentRsi > 62) return { side: 'sell', confidence: 0.57, technicalScore: 24, reason: `mean_reversion SELL: RSI ${currentRsi.toFixed(1)}` };
  }
  if (strategy.includes('momentum') || bot.type === 'ai_sentiment') {
    if (return25m > 0.12 || ticker.price > high12) return { side: 'buy', confidence: 0.6, technicalScore: 33, reason: `momentum BUY: retorno 25m ${return25m.toFixed(3)}%` };
    if (return25m < -0.15) return { side: 'sell', confidence: 0.56, technicalScore: 22, reason: 'momentum SELL: momentum debilitado' };
  }
  if (ema9 > ema21 && ema9 > ema9Prev && currentRsi < 72) return { side: 'buy', confidence: 0.6, technicalScore: 35, reason: `ema_cross BUY: EMA9 ${ema9.toFixed(4)} > EMA21 ${ema21.toFixed(4)}` };
  if (ema9 < ema21) return { side: 'sell', confidence: 0.56, technicalScore: 22, reason: `ema_cross SELL: EMA9 ${ema9.toFixed(4)} < EMA21 ${ema21.toFixed(4)}` };
  return { side: 'hold', confidence: 0.4, technicalScore: 8, reason: 'Sin señal técnica suficiente' };
}

function liquidityScore(candles, ticker, minQuote) {
  const recent = candles.slice(-12);
  const avgQuoteVolume = recent.reduce((sum, candle) => sum + candle.volume * candle.close, 0) / Math.max(recent.length, 1);
  if (!avgQuoteVolume || avgQuoteVolume < Math.max(minQuote * 2, 15)) return { ok: false, score: 0, avgQuoteVolume, reason: 'volumen insuficiente' };
  if (ticker.volume24h * ticker.price < Math.max(minQuote * 30, 250)) return { ok: false, score: 4, avgQuoteVolume, reason: 'liquidez baja' };
  return { ok: true, score: Math.min(15, Math.round(avgQuoteVolume / Math.max(minQuote, 1))), avgQuoteVolume, reason: 'volumen OK' };
}

async function evaluateCandidate({ bot, pair, balances, openTrades, maxQuote, minReserved }) {
  const normalizedPair = normalizePair(pair);
  const strategy = bot.strategy || bot.type || 'ema_cross';
  const plan = capitalPlan(normalizedPair, balances, openTrades, maxQuote, minReserved);
  if (openTrades.some(trade => normalizePair(trade.pair) === normalizedPair)) throw new Error('ya existe trade abierto del mismo par');
  if (openTrades.some(trade => trade.bot_name === bot.name && normalizePair(trade.pair) === normalizedPair)) throw new Error('ya existe trade abierto del mismo bot/par');

  const [ticker, rules, candles] = await Promise.all([getTicker(normalizedPair), getAssetPairRules(normalizedPair), getCandles(normalizedPair, 5)]);
  const minQuote = minRequiredQuote(rules, ticker.price);
  const volume = roundDown(plan.orderQuote / ticker.price, rules.lot_decimals);
  if (ticker.spreadPct > 0.25) throw new Error('spread alto');
  if (plan.orderQuote < minQuote || volume < rules.ordermin) throw new Error('capital insuficiente para mínimo Kraken');
  const liquidity = liquidityScore(candles, ticker, minQuote);
  if (!liquidity.ok) throw new Error(liquidity.reason);

  const technical = evaluateTechnical(bot, candles, ticker);
  const spreadScore = Math.max(0, Math.round(20 - ticker.spreadPct * 70));
  const capitalScore = plan.orderQuote >= minQuote ? 20 : 0;
  const positionScore = 10;
  const recencyScore = 5;
  const score = Math.min(100, technical.technicalScore + spreadScore + liquidity.score + capitalScore + positionScore + recencyScore);
  const status = technical.side === 'hold' || score < 55 || technical.confidence < 0.55 ? 'rejected' : 'new';
  const reason = status === 'new' ? technical.reason : `${technical.reason} · score ${score}/55`;

  return { bot, pair: normalizedPair, strategy, ticker, rules, candles, plan, minQuote, volume, liquidity, technical, score, status, reason };
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
    const maxQuote = Math.min(Number(Deno.env.get('MAX_LIVE_ORDER_QUOTE') || '8'), 8);
    const minReserved = Number(Deno.env.get('MIN_RESERVED_QUOTE') || '2');
    const liveAllowed = toBool(Deno.env.get('KRAKEN_LIVE_TRADING')) && toBool(Deno.env.get('BOTCO_LIVE_ENABLED'));
    const sessions = await entities.BotSession.filter({ active: true }, '-created_date', 5);
    const liveSession = sessions.find(session => session.mode === 'live');
    const allBots = await entities.Bot.list();
    const bots = allBots.filter(bot => bot.status === 'active' && bot.trading_mode === 'live' && bot.live_enabled === true && (bot.exchange || 'kraken') === 'kraken');
    const created = [];
    const rejected = [];

    if (!liveAllowed || !liveSession || !bots.length) {
      const reason = !liveAllowed ? 'KRAKEN_LIVE_TRADING/BOTCO_LIVE_ENABLED false' : !liveSession ? 'No hay BotSession LIVE activa' : 'No hay bots LIVE activos';
      return Response.json({ ok: true, scannerTick: now.toISOString(), skipped: true, reason, scannedPairs: PAIRS, scannedBots: bots.length, signalsCreated: 0, signalsRejected: 0 });
    }

    const openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);
    const balances = await krakenPrivate('Balance');
    const jobs = [];
    for (const bot of bots) {
      for (const pair of PAIRS) {
        jobs.push(
          evaluateCandidate({ bot, pair, balances, openTrades, maxQuote: Math.min(Number(bot.max_order_quote || bot.max_order_usd || maxQuote), maxQuote), minReserved })
            .catch(error => ({ rejectedOnly: true, bot, pair, reason: error.message }))
        );
      }
    }

    const settled = await Promise.allSettled(jobs);
    const candidates = [];
    const rejectedCandidates = [];
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value?.rejectedOnly) rejectedCandidates.push(result.value);
      else if (result.status === 'fulfilled') candidates.push(result.value);
      else rejected.push({ reason: result.reason?.message || 'error evaluando par' });
    }

    for (const item of rejectedCandidates) {
      const signal = await entities.Signal.create({
        bot_name: item.bot.name,
        bot_id: item.bot.id,
        strategy: item.bot.strategy || item.bot.type,
        exchange: 'kraken',
        pair: item.pair,
        side: 'hold',
        confidence: 0,
        score: 0,
        reason: item.reason,
        price: 0,
        timeframe: '5m',
        status: 'rejected',
        expires_at: expiresAt,
        raw_data: JSON.stringify({ scannedPairs: PAIRS, parallel: true, rejectedPair: item.pair, reason: item.reason })
      });
      created.push(signal);
      rejected.push({ bot: item.bot.name, pair: item.pair, reason: item.reason });
    }

    const sorted = candidates.sort((a, b) => b.score - a.score);
    for (const item of sorted) {
      const signal = await entities.Signal.create({
        bot_name: item.bot.name,
        bot_id: item.bot.id,
        strategy: item.strategy,
        exchange: 'kraken',
        pair: item.pair,
        side: item.technical.side,
        confidence: item.technical.confidence,
        score: item.score,
        reason: item.reason,
        price: item.ticker.price,
        timeframe: '5m',
        status: item.status,
        expires_at: expiresAt,
        min_required_quote: Number(item.minQuote.toFixed(8)),
        available_quote: Number(item.plan.balanceQuote.toFixed(8)),
        order_quote: Number(item.plan.orderQuote.toFixed(8)),
        spread_pct: Number(item.ticker.spreadPct.toFixed(4)),
        volume_score: item.liquidity.score,
        raw_data: JSON.stringify({ scannedPairs: PAIRS, parallel: true, ordermin: item.rules.ordermin, costmin: item.rules.costmin, lotDecimals: item.rules.lot_decimals, pairDecimals: item.rules.pair_decimals, avgQuoteVolume5m: item.liquidity.avgQuoteVolume, balanceQuote: item.plan.balanceQuote, exposureQuote: item.plan.exposure, maxQuote, minReserved })
      });
      created.push(signal);
      if (item.status === 'rejected') rejected.push({ bot: item.bot.name, pair: item.pair, reason: signal.reason });
    }

    const missingExecutable = bots.filter(bot => !created.some(signal => signal.bot_id === bot.id && signal.status === 'new'));
    for (const bot of missingExecutable) {
      const botRejected = rejected.slice(0, 12);
      const signal = await entities.Signal.create({ bot_name: bot.name, bot_id: bot.id, strategy: bot.strategy || bot.type, exchange: 'kraken', pair: 'AUTO', side: 'hold', confidence: 0, score: 0, reason: 'Sin señal ejecutable: revisar motivos por par en raw_data', price: 0, timeframe: '5m', status: 'rejected', expires_at: expiresAt, raw_data: JSON.stringify({ scannedPairs: PAIRS, parallel: true, rejected: botRejected }) });
      created.push(signal);
    }

    if (liveSession?.id) await entities.BotSession.update(liveSession.id, { last_tick_at: now.toISOString(), last_error: '' });
    return Response.json({ ok: true, scannerTick: now.toISOString(), parallel: true, scannedPairs: PAIRS, scannedBots: bots.length, evaluations: settled.length, signalsCreated: created.length, signalsRejected: rejected.length, bestSignals: created.filter(signal => signal.status === 'new').slice(0, 5), reasons: rejected.slice(0, 20) });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});