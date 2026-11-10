import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const SUPPORTED_PAIRS = ['ETHEUR', 'ADAEUR', 'XRPEUR', 'SOLEUR', 'DOTEUR', 'LINKEUR', 'ATOMEUR', 'XBTEUR'];
const QUOTE_KEYS = { USD: ['ZUSD', 'USD'], EUR: ['ZEUR', 'EUR'] };
const ASSET_KEYS = { XBT: ['XXBT', 'XBT'], ETH: ['XETH', 'ETH'], SOL: ['SOL'], XRP: ['XXRP', 'XRP'], ADA: ['ADA'], DOT: ['DOT'], LINK: ['LINK'], ATOM: ['ATOM'] };
const DISPLAY_PAIRS = { XBTEUR: 'BTC/EUR', ETHEUR: 'ETH/EUR', SOLEUR: 'SOL/EUR', XRPEUR: 'XRP/EUR', ADAEUR: 'ADA/EUR', DOTEUR: 'DOT/EUR', LINKEUR: 'LINK/EUR', ATOMEUR: 'ATOM/EUR' };
const MASTER_STRATEGY = {
  version: 'SentinelAI Pro v2',
  role: 'Sistema institucional de trading algorítmico crypto para Kraken Spot, sin leverage, sin margin y sin futures.',
  minScore: 75,
  minRiskReward: 1,
  preferredRiskReward: 3,
  weights: { trend: 25, momentum: 20, volume: 15, volatility: 15, macro: 15, sentiment: 10 },
  rules: [
    'Capital inicial como línea roja sagrada: preservar capital antes que buscar ganancias rápidas.',
    'Adaptar score, pares, TP, SL y máximo de operaciones al capital disponible real.',
    'No operar si falla cualquier filtro obligatorio de score, spread, volumen, liquidez, correlación o riesgo.',
    'Nunca promediar pérdidas, perseguir precio, duplicar tamaño para recuperar ni ampliar stop loss contra la posición.',
    'Un día sin operar es mejor que una pérdida evitable.'
  ]
};

const STRATEGY_RISK = {
  micro_scalp: { timeoutMinutes: 45, takeProfitPct: 0.40, stopLossPct: 0.80 },
  micro_scalp_test: { timeoutMinutes: 45, takeProfitPct: 0.40, stopLossPct: 0.80 },
  ema_cross: { timeoutMinutes: 120, takeProfitPct: 0.40, stopLossPct: 0.80 },
  mean_reversion: { timeoutMinutes: 90, takeProfitPct: 0.40, stopLossPct: 0.80 },
  first_live_trade: { timeoutMinutes: 60, takeProfitPct: 0.40, stopLossPct: 0.80 },
  default: { timeoutMinutes: 90, takeProfitPct: 0.40, stopLossPct: 0.80 }
};

let lastNonce = 0;
const publicCache = new Map();
const feeCache = new Map();
const FALLBACK_TAKER_FEE_PCT = 0.26;
const DEFAULT_RISK = { kill_switch: false, max_open_trades: 1, max_loss_per_trade_eur: 0.2, max_daily_loss_eur: 0.6, max_trades_per_day: 3, min_reward_risk: 1.5, max_hold_minutes: 240 };

function nextNonce() { const now = Date.now() * 1000; lastNonce = Math.max(now, lastNonce + 1); return String(lastNonce); }
function tickId() { return `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function toBool(value) { return String(value || '').toLowerCase() === 'true'; }
function normalizePair(pair) { const value = String(pair || '').replace('/', '').toUpperCase(); if (value === 'BTCEUR') return 'XBTEUR'; if (value === 'BTCUSD') return 'XBTUSD'; return value; }
function displayPair(pair) { return DISPLAY_PAIRS[normalizePair(pair)] || normalizePair(pair); }
function quoteCurrency(pair) { return normalizePair(pair).endsWith('EUR') ? 'EUR' : 'USD'; }
function baseAsset(pair) { const value = normalizePair(pair); if (value.startsWith('XBT')) return 'XBT'; if (value.startsWith('ETH')) return 'ETH'; if (value.startsWith('SOL')) return 'SOL'; if (value.startsWith('XRP')) return 'XRP'; if (value.startsWith('ADA')) return 'ADA'; if (value.startsWith('DOT')) return 'DOT'; if (value.startsWith('LINK')) return 'LINK'; if (value.startsWith('ATOM')) return 'ATOM'; return value.slice(0, -3); }
// Única función para el capital real en EUR de Kraken
function getCapitalEUR(balances) { return QUOTE_KEYS.EUR.reduce((sum, key) => sum + Number(balances?.[key] || 0), 0); }
function getAssetBalance(balances, asset) { return (ASSET_KEYS[asset] || [asset]).reduce((sum, key) => sum + Number(balances[key] || 0), 0); }
function roundDown(value, decimals) { const factor = 10 ** decimals; return Math.floor(value * factor) / factor; }
function ema(values, period) { if (values.length < period) return values[values.length - 1] || 0; const k = 2 / (period + 1); return values.slice(1).reduce((prev, value) => value * k + prev * (1 - k), values[0]); }
function rsi(values, period = 14) { if (values.length <= period) return 50; const slice = values.slice(-period - 1); let gains = 0; let losses = 0; for (let i = 1; i < slice.length; i++) { const diff = slice[i] - slice[i - 1]; if (diff >= 0) gains += diff; else losses += Math.abs(diff); } if (losses === 0) return 100; const rs = gains / losses; return 100 - (100 / (1 + rs)); }
function minRequiredQuote(rules, price) { return Math.max(Number(rules.costmin || 0), Number(rules.ordermin || 0) * price); }
function quoteExposure(openTrades, quote) { return openTrades.filter(trade => quoteCurrency(trade.pair) === quote).reduce((sum, trade) => sum + Number(trade.cost || (Number(trade.entry_price || 0) * Number(trade.amount || 0))), 0); }
function capitalProfile(capital) {
  if (capital >= 50000) return { name: 'institucional', minScore: 85, maxOpenTrades: 3, takeProfitPct: 2.00, stopLossPct: 0.80, pairs: ['XBTEUR', 'ETHEUR'] };
  if (capital >= 5000) return { name: 'alto', minScore: 80, maxOpenTrades: 4, takeProfitPct: 1.00, stopLossPct: 0.50, pairs: ['XBTEUR', 'ETHEUR', 'SOLEUR'] };
  if (capital >= 500) return { name: 'medio', minScore: 75, maxOpenTrades: 3, takeProfitPct: 0.80, stopLossPct: 0.40, pairs: SUPPORTED_PAIRS };
  if (capital >= 50) return { name: 'pequeño', minScore: 70, maxOpenTrades: 2, takeProfitPct: 0.45, stopLossPct: 0.25, pairs: SUPPORTED_PAIRS };
  return { name: 'pequeño', minScore: 60, maxOpenTrades: 2, takeProfitPct: 0.45, stopLossPct: 0.25, pairs: ['ETHEUR', 'XRPEUR', 'ADAEUR', 'SOLEUR'] };
}
function adjustedRisk(strategy, spreadPct = 0, profile = null, takerFeePct = FALLBACK_TAKER_FEE_PCT) {
  const base = profile ? { timeoutMinutes: profile.name === 'micro' ? 30 : 90, takeProfitPct: profile.takeProfitPct, stopLossPct: profile.stopLossPct } : (STRATEGY_RISK[strategy] || STRATEGY_RISK.default);
  const estimatedRoundTripFeesPct = takerFeePct * 2;
  // El objetivo debe cubrir 1,5× el riesgo neto después de comisiones de ida y vuelta y spread
  const requiredTakeProfitPct = DEFAULT_RISK.min_reward_risk * (base.stopLossPct + estimatedRoundTripFeesPct + spreadPct) + estimatedRoundTripFeesPct + spreadPct;
  return { ...base, takerFeePct, estimatedRoundTripFeesPct, takeProfitPct: Math.max(base.takeProfitPct, requiredTakeProfitPct, spreadPct + estimatedRoundTripFeesPct + 0.05) };
}

function rewardRisk({ takeProfitPct, stopLossPct, roundTripFeePct, spreadPct, minRewardRisk = DEFAULT_RISK.min_reward_risk }) {
  const netRewardPct = takeProfitPct - roundTripFeePct - spreadPct;
  const netRiskPct = stopLossPct + roundTripFeePct + spreadPct;
  const ratio = netRiskPct > 0 ? netRewardPct / netRiskPct : 0;
  return { ok: netRewardPct > 0 && ratio >= minRewardRisk, ratio: Number(ratio.toFixed(3)), netRewardPct: Number(netRewardPct.toFixed(4)), netRiskPct: Number(netRiskPct.toFixed(4)) };
}

function envConfig() {
  const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'KRAKEN_LIVE_TRADING', 'BOTCO_LIVE_ENABLED'];
  const missing = required.filter(name => !Deno.env.get(name));
  const maxQuote = 25;
  const maxOpenTrades = 1;
  const minReservedQuote = 4;
  const intervalMinutes = Math.max(5, Number(Deno.env.get('BOTCO_AUTOTRADE_INTERVAL_MINUTES') || '5'));
  const krakenLiveTrading = toBool(Deno.env.get('KRAKEN_LIVE_TRADING'));
  const botcoLiveEnabled = toBool(Deno.env.get('BOTCO_LIVE_ENABLED'));
  return { missing, maxQuote, maxOpenTrades, minReservedQuote, intervalMinutes, krakenLiveTrading, botcoLiveEnabled, ok: missing.length === 0 && krakenLiveTrading && botcoLiveEnabled && maxQuote > 0 };
}

function applyDynamicCapitalEnv(env, balances) {
  const capitalEUR = getCapitalEUR(balances || {});
  return { ...env, capitalEUR, maxQuote: capitalEUR > 0 ? Math.floor(capitalEUR * 0.85) : 25, maxOpenTrades: 1, minReservedQuote: 4 };
}

function assertLiveEnv() {
  const env = envConfig();
  if (env.missing.length) throw new Error(`Faltan variables LIVE: ${env.missing.join(', ')}`);
  if (!env.krakenLiveTrading) throw new Error('KRAKEN_LIVE_TRADING debe ser true');
  if (!env.botcoLiveEnabled) throw new Error('BOTCO_LIVE_ENABLED debe ser true');
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

async function getTicker(pair) {
  const result = await krakenPublic('Ticker', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const ticker = result[key];
  const ask = Number(ticker.a?.[0] || 0);
  const bid = Number(ticker.b?.[0] || 0);
  const price = Number(ticker.c?.[0] || 0);
  const volume24h = Number(ticker.v?.[1] || 0);
  if (!ask || !bid || !price || ask <= bid) throw new Error(`ticker inválido para ${displayPair(pair)}`);
  const open24 = Number(ticker.o || 0);
  return { price, bid, ask, spreadPct: ((ask - bid) / price) * 100, volume24h, open24, changePct: open24 ? ((price - open24) / open24) * 100 : 0 };
}

async function getAssetPairRules(pair) {
  const result = await krakenPublic('AssetPairs', { pair: normalizePair(pair) });
  const key = Object.keys(result)[0];
  const raw = result[key] || {};
  return { pair: normalizePair(pair), status: String(raw.status || 'online'), ordermin: Number(raw.ordermin || 0), costmin: Number(raw.costmin || 0), lot_decimals: Number(raw.lot_decimals ?? 8), pair_decimals: Number(raw.pair_decimals ?? 2) };
}

async function getCandles(pair, interval = 5, limit = 240) {
  const result = await krakenPublic('OHLC', { pair: normalizePair(pair), interval });
  const key = Object.keys(result).find(item => item !== 'last');
  // La última vela de OHLC está sin cerrar: se descarta en todas las decisiones
  return (result[key] || []).slice(0, -1).slice(-limit).map(row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[6]) }));
}

function liquidityCheck(candles, ticker, minQuote) {
  const recent = candles.slice(-12);
  const avgQuoteVolume = recent.reduce((sum, candle) => sum + candle.volume * candle.close, 0) / Math.max(recent.length, 1);
  if (!avgQuoteVolume || avgQuoteVolume < Math.max(minQuote * 2, 15)) return { ok: false, score: 0, reason: 'volumen insuficiente', avgQuoteVolume };
  if (ticker.volume24h * ticker.price < Math.max(minQuote * 30, 250)) return { ok: false, score: 4, reason: 'liquidez baja', avgQuoteVolume };
  return { ok: true, score: Math.min(15, Math.round(avgQuoteVolume / Math.max(minQuote, 1))), reason: 'volumen OK', avgQuoteVolume };
}

function average(values) { return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1); }
function standardDeviation(values) { const mean = average(values); return Math.sqrt(average(values.map(value => (value - mean) ** 2))); }
function roc(values, period = 12) { if (values.length <= period) return 0; const prev = values[values.length - period - 1]; return prev ? ((values[values.length - 1] - prev) / prev) * 100 : 0; }
function atr(candles, period = 14) {
  const slice = candles.slice(-period - 1);
  if (slice.length < 2) return 0;
  const ranges = [];
  for (let i = 1; i < slice.length; i++) ranges.push(Math.max(slice[i].high - slice[i].low, Math.abs(slice[i].high - slice[i - 1].close), Math.abs(slice[i].low - slice[i - 1].close)));
  return average(ranges);
}
function macd(values) {
  const line = ema(values.slice(-80), 12) - ema(values.slice(-80), 26);
  const signal = ema(values.slice(-35).map((_, index, arr) => ema(values.slice(0, values.length - arr.length + index + 1), 12) - ema(values.slice(0, values.length - arr.length + index + 1), 26)), 9);
  return { line, signal, histogram: line - signal };
}
function adxProxy(candles, period = 14) {
  const recent = candles.slice(-period - 1);
  if (recent.length < 2) return 0;
  let directional = 0;
  let range = 0;
  for (let i = 1; i < recent.length; i++) { directional += Math.abs(recent[i].close - recent[i - 1].close); range += recent[i].high - recent[i].low; }
  return range ? Math.min(50, (directional / range) * 50) : 0;
}
function marketStructure(candles, ticker) {
  const recent = candles.slice(-36);
  const highs = recent.map(candle => candle.high);
  const lows = recent.map(candle => candle.low);
  const resistance = Math.max(...highs.slice(0, -1));
  const support = Math.min(...lows.slice(0, -1));
  const breakout = ticker.price > resistance;
  const falseBreak = recent.at(-1)?.high > resistance && ticker.price < resistance;
  const liquiditySweep = recent.at(-1)?.low < support && ticker.price > support;
  return { support, resistance, breakout, falseBreak, liquiditySweep };
}

function evaluateTechnical(bot, candles, ticker, liquidity, profile) {
  const closes = candles.map(c => c.close);
  const strategy = bot.strategy || bot.type || 'ema_cross';
  const currentRsi = rsi(closes);
  const currentRoc = roc(closes, 12);
  const currentMacd = macd(closes);
  const currentAtr = atr(candles);
  const atrPct = ticker.price ? (currentAtr / ticker.price) * 100 : 0;
  const adx = adxProxy(candles);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema100 = ema(closes, 100);
  const ema200 = ema(closes, 200);
  const bbSlice = closes.slice(-20);
  const bbMean = average(bbSlice);
  const bbWidthPct = ticker.price ? ((standardDeviation(bbSlice) * 4) / ticker.price) * 100 : 0;
  const structure = marketStructure(candles, ticker);
  const macroScore = 8;
  const sentimentScore = Math.min(MASTER_STRATEGY.weights.sentiment, Math.max(0, (bot.type === 'ai_sentiment' ? 4 : 2) + (currentRoc > 0 ? 4 : 0) + (currentMacd.histogram > 0 ? 2 : 0)));

  const bullishTrend = ticker.price > ema200 && ema20 > ema50 && ema50 >= ema100;
  const bearishTrend = ticker.price < ema100 && ema20 < ema50;
  const trendScore = bullishTrend ? 25 : ticker.price > ema200 && ema20 > ema50 ? 20 : ticker.price > ema50 ? 14 : 5;
  const momentumScore = Math.min(20, Math.max(0, (currentRsi >= 45 && currentRsi <= 68 ? 7 : currentRsi < 35 ? 3 : 0) + (currentMacd.histogram > 0 ? 6 : 0) + (currentRoc > 0.08 ? 5 : 0) + (adx > 18 ? 2 : 0)));
  const volumeScore = Math.min(15, liquidity?.score || 0);
  const volatilityScore = atrPct > 0.05 && atrPct < 2.5 && bbWidthPct < 8 ? 15 : atrPct < 4 ? 9 : 3;
  const priceActionBonus = structure.breakout || structure.liquiditySweep ? 5 : structure.falseBreak ? -8 : 0;
  const score = Math.max(0, Math.min(100, trendScore + momentumScore + volumeScore + volatilityScore + macroScore + sentimentScore + priceActionBonus));

  const meanReversionValid = (strategy.includes('mean') || bot.type === 'mean_reversion') && currentRsi < 38 && ticker.price > structure.support && !structure.falseBreak && !bearishTrend;
  const trendEntryValid = bullishTrend && momentumScore >= 12 && !structure.falseBreak;
  const requiredScore = profile?.minScore || MASTER_STRATEGY.minScore;
  const side = (trendEntryValid || meanReversionValid) && score >= requiredScore ? 'buy' : bearishTrend ? 'sell' : 'hold';
  const confidence = Number((score / 100).toFixed(2));
  const reason = `${MASTER_STRATEGY.version}: ${side.toUpperCase()} score ${score}/100 · perfil ${profile?.name || 'estándar'} exige ${requiredScore} · tendencia ${trendScore}/25 · momentum ${momentumScore}/20 · volumen ${volumeScore}/15 · volatilidad ${volatilityScore}/15 · macro ${macroScore}/15 · sentimiento ${sentimentScore}/10 · RSI ${currentRsi.toFixed(1)} · RR mínimo 1:${MASTER_STRATEGY.minRiskReward}`;
  return { side, confidence, technicalScore: score, score, requiredScore, profile: profile?.name || 'estándar', scoreComponents: { trendScore, momentumScore, volumeScore, volatilityScore, macroScore, sentimentScore, priceActionBonus, atrPct, bbWidthPct, adx, support: structure.support, resistance: structure.resistance }, reason };
}

async function placeMarketOrder(pair, side, volume) { return krakenPrivate('AddOrder', { pair: normalizePair(pair), type: side, ordertype: 'market', volume: String(volume), validate: 'false' }); }
async function placeStopLossOrder(pair, volume, stopPrice, pairDecimals) { return krakenPrivate('AddOrder', { pair: normalizePair(pair), type: 'sell', ordertype: 'stop-loss', volume: String(volume), price: String(roundTick(stopPrice, pairDecimals)), validate: 'false' }); }
async function getBalances() { return krakenPrivate('Balance'); }

function roundTick(value, decimals) { const factor = 10 ** Number(decimals ?? 2); return (Math.round(Number(value) * factor) / factor).toFixed(Number(decimals ?? 2)); }

async function getOpenOrders() { const result = await krakenPrivate('OpenOrders', { trades: false }); return result?.open || {}; }

// Comisión taker real de la cuenta vía TradeVolume, con caché de 1 hora
async function getTakerFeePct(pair) {
  const key = normalizePair(pair);
  const cached = feeCache.get(key);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.feePct;
  try {
    const result = await krakenPrivate('TradeVolume', { pair: key });
    const fees = result?.fees || {};
    const entry = fees[key] || fees[Object.keys(fees)[0]] || {};
    const feePct = Number(entry.fee);
    if (!Number.isFinite(feePct) || feePct <= 0) throw new Error('TradeVolume sin fee válida');
    feeCache.set(key, { at: Date.now(), feePct });
    return feePct;
  } catch (error) {
    console.log(`TradeVolume ${key} no disponible: ${error.message}`);
    return FALLBACK_TAKER_FEE_PCT;
  }
}

async function getOrderExecution(txid) {
  if (!txid) throw new Error('Kraken no devolvió txid');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1200));
    const result = await krakenPrivate('QueryOrders', { txid, trades: 'true' });
    const order = result?.[txid] || Object.values(result || {})[0];
    if (!order) continue;
    const executedVolume = Number(order.vol_exec || 0);
    const cost = Number(order.cost || 0);
    const fee = Number(order.fee || 0);
    const price = Number(order.price || 0) || (executedVolume ? cost / executedVolume : 0);
    if (executedVolume > 0 && price > 0) return { txid, executed_price: price, executed_volume: executedVolume, fee, cost, raw_order: order };
  }
  throw new Error(`Kraken aún no confirmó ejecución para ${txid}`);
}

async function cancelOrder(txid) { return krakenPrivate('CancelOrder', { txid }); }
async function queryOrder(txid) { const result = await krakenPrivate('QueryOrders', { txid, trades: 'true' }); return result?.[txid] || Object.values(result || {})[0] || null; }

// Cierre a mercado seguro: el stop-loss de Kraken tiene reservado el saldo, así que se cancela
// antes de vender. Si la venta falla, el stop se vuelve a colocar en el acto: la posición nunca
// se queda sin red, y nunca queda un stop vivo de una posición ya cerrada.
async function closeTradeMarket(trade, currentPrice, closeRatio = 1, entities = null) {
  const pair = normalizePair(trade.pair);
  const rules = await getAssetPairRules(pair);
  const stopTxid = trade.exchange_stop_txid || '';
  let stopCancelled = false;
  if (stopTxid) {
    try { await cancelOrder(stopTxid); stopCancelled = true; await new Promise(resolve => setTimeout(resolve, 800)); }
    catch (error) {
      // Si el stop ya no existe (ejecutado o cancelado), seguimos; si es otro error, no vendemos
      if (!/Unknown order|EOrder:Invalid order/i.test(error.message)) throw new Error(`No se pudo cancelar el stop ${stopTxid}: ${error.message}`);
    }
  }
  try {
    return await sellAtMarket(trade, pair, rules, currentPrice, closeRatio);
  } catch (error) {
    if (stopCancelled && entities && trade.id) {
      try {
        const response = await placeStopLossOrder(pair, Number(trade.amount || trade.executed_volume || 0), Number(trade.stop_loss || 0), rules.pair_decimals);
        const txid = Array.isArray(response.txid) ? response.txid[0] : '';
        if (txid) await entities.Trade.update(trade.id, { exchange_stop_txid: txid });
      } catch (stopError) { error.message += ` · y no se pudo recolocar el stop: ${stopError.message}`; }
    }
    throw error;
  }
}

async function sellAtMarket(trade, pair, rules, currentPrice, closeRatio) {
  const asset = baseAsset(pair);
  const balances = await getBalances();
  const availableAsset = getAssetBalance(balances, asset);
  const totalAmount = Number(trade.amount || trade.executed_volume || 0);
  // Sin el recorte del 0,5 % que dejaba "polvo" invendible tras cada cierre
  const requestedPartial = totalAmount * closeRatio;
  const requestedFull = totalAmount;
  let closeAmount = Math.min(requestedPartial, availableAsset);
  let volume = roundDown(closeAmount, rules.lot_decimals);
  if (closeRatio < 1) {
    const remaining = Math.max(0, totalAmount - volume);
    const partBelowMin = !volume || (rules.ordermin && volume < rules.ordermin) || (rules.costmin && volume * currentPrice < rules.costmin);
    const remainingBelowMin = remaining > 0 && ((rules.ordermin && remaining < rules.ordermin) || (rules.costmin && remaining * currentPrice < rules.costmin));
    // Nunca cerrar en parcial si alguna de las dos partes queda por debajo del mínimo: se cierra el 100 %
    if (partBelowMin || remainingBelowMin) {
      closeAmount = Math.min(requestedFull, availableAsset);
      volume = roundDown(closeAmount, rules.lot_decimals);
    }
  }
  if (!volume || volume <= 0 || (rules.ordermin && volume < rules.ordermin)) throw new Error(`Volumen de cierre inferior al mínimo Kraken para ${displayPair(pair)}`);
  if (rules.costmin && volume * currentPrice < rules.costmin) throw new Error(`Coste de cierre inferior al mínimo Kraken para ${displayPair(pair)}`);
  const response = await placeMarketOrder(pair, trade.side === 'buy' ? 'sell' : 'buy', volume);
  const closeOrderId = Array.isArray(response.txid) ? response.txid[0] : '';
  if (!closeOrderId) throw new Error('Kraken no devolvió txid de cierre');
  const execution = await getOrderExecution(closeOrderId);
  return { response, execution };
}

// Usa el TP y el SL guardados en el trade (los que aprobó riskGate con comisiones incluidas).
// Antes había un "partial TP" al +0,30 % bruto que en la práctica cerraba el 100 % y, tras
// comisiones de ida y vuelta, convertía las "ganancias" en pérdidas.
function shouldCloseTrade(trade, ticker, forceClose, riskConfig) {
  if (forceClose) return { close: true, reason: 'Cierre manual solicitado' };
  const entry = Number(trade.entry_price || 0);
  const amount = Number(trade.amount || 0);
  if (!entry || !amount) return { close: false, reason: 'Trade sin entrada o volumen válido' };
  const pnlPct = ((ticker.price - entry) / entry) * (trade.side === 'buy' ? 1 : -1) * 100;
  const ageMs = Date.now() - new Date(trade.entry_date || trade.created_date).getTime();
  const maxHold = Number(riskConfig?.max_hold_minutes || DEFAULT_RISK.max_hold_minutes);
  const stopLossPrice = Number(trade.stop_loss || 0);
  const takeProfitPrice = Number(trade.take_profit || 0);
  // El stop lo ejecuta Kraken; esto solo actúa si el precio ya está por debajo y el stop no saltó
  if (stopLossPrice > 0 && ticker.bid <= stopLossPrice) return { close: true, reason: `SL ${stopLossPrice} alcanzado`, pnlPct };
  if (takeProfitPrice > 0 && ticker.bid >= takeProfitPrice) return { close: true, reason: `TP ${takeProfitPrice} alcanzado`, pnlPct };
  if (ageMs >= maxHold * 60 * 1000) return { close: true, reason: `Tiempo máximo ${maxHold} minutos`, pnlPct };
  return { close: false, reason: `Monitoreando: TP ${takeProfitPrice || '—'} · SL ${stopLossPrice || '—'} · máx ${maxHold}m`, pnlPct };
}

async function createAlert(entities, title, message, severity = 'info') { try { await entities.Alert.create({ title, message, severity, source: 'tradingLoop LIVE', is_read: false }); } catch (error) { console.log(`Alert skipped: ${error.message}`); } }
async function safeBotUpdate(entities, botId, data) { if (!botId) return; try { await entities.Bot.update(botId, data); } catch (error) { console.log(`Bot update skipped: ${error.message}`); } }
async function rejectSignal(entities, signal, reason) { if (!signal?.id) return; await entities.Signal.update(signal.id, { status: 'consumed', reason: `${signal.reason || ''} · rejected: ${reason}` }); }
async function markSignal(entities, signal, status, reason) { if (!signal?.id) return; await entities.Signal.update(signal.id, { status, reason: reason ? `${signal.reason || ''} · ${reason}` : signal.reason }); }

async function getFreshSignals(entities) {
  const now = Date.now();
  const signals = await entities.Signal.filter({ status: 'new' }, '-created_date', 120);
  const fresh = [];
  for (const signal of signals) {
    if (signal.expires_at && new Date(signal.expires_at).getTime() <= now) await entities.Signal.update(signal.id, { status: 'expired', reason: `${signal.reason || ''} · expired: superó ventana de ejecución` });
    else fresh.push(signal);
  }
  return fresh;
}

function rankSignals(signals) {
  return signals.filter(signal => signal.side === 'buy' && Number(signal.score || 0) >= 60 && Number(signal.confidence || 0) >= 0.60).sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || (Number(b.confidence || 0) - Number(a.confidence || 0)) || (new Date(b.created_date) - new Date(a.created_date)));
}

async function evaluateCandidate({ bot, pair, balances, openTrades, existingSignals, env }) {
  const normalizedPair = normalizePair(pair);
  if (openTrades.some(trade => normalizePair(trade.pair) === normalizedPair)) throw new Error('ya existe trade abierto del mismo par');
  if (existingSignals.some(signal => signal.bot_id === bot.id && normalizePair(signal.pair) === normalizedPair)) throw new Error('ya existe señal nueva del mismo bot/par');
  const [ticker, rules, candles] = await Promise.all([getTicker(normalizedPair), getAssetPairRules(normalizedPair), getCandles(normalizedPair, 5)]);
  const quote = 'EUR';
  const balanceQuote = getCapitalEUR(balances);
  const exposure = quoteExposure(openTrades, quote);
  const profile = capitalProfile(balanceQuote + exposure);
  if (!profile.pairs.includes(normalizedPair)) throw new Error(`perfil ${profile.name}: par no prioritario`);
  const spendable = Math.max(0, balanceQuote - env.minReservedQuote);
  const budgetLeft = Math.max(0, (balanceQuote + exposure) * 0.8 - exposure);
  const maxBotQuote = Math.min(Number(bot.max_order_quote || bot.max_order_usd || env.maxQuote), env.maxQuote);
  const orderQuote = Math.min(maxBotQuote, spendable, budgetLeft);
  const minQuote = minRequiredQuote(rules, ticker.price);
  const volume = roundDown(orderQuote / ticker.price, rules.lot_decimals);
  if (ticker.spreadPct > 0.25) throw new Error('spread alto');
  if (orderQuote < minQuote || volume < rules.ordermin) throw new Error('capital insuficiente para mínimo Kraken');
  const liquidity = liquidityCheck(candles, ticker, minQuote);
  if (!liquidity.ok) throw new Error(liquidity.reason);
  const technical = evaluateTechnical(bot, candles, ticker, liquidity, profile);
  const score = technical.score;
  const status = technical.side === 'buy' && score >= profile.minScore && technical.confidence >= 0.65 ? 'new' : 'rejected';
  const reason = status === 'new' ? technical.reason : `${technical.reason} · no operar: score mínimo ${profile.minScore} para capital ${profile.name}`;
  return { bot, pair: normalizedPair, strategy: MASTER_STRATEGY.version, ticker, rules, plan: { balanceQuote, exposure, orderQuote, profile }, minQuote, liquidity, technical, score, status, reason };
}

async function runScanner(entities, liveSession, liveBots, balances, openTrades, env) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3 * 60 * 1000).toISOString();
  const existingSignals = await getFreshSignals(entities);
  const jobs = [];
  for (const bot of liveBots) {
    for (const pair of SUPPORTED_PAIRS) {
      jobs.push(evaluateCandidate({ bot, pair, balances, openTrades, existingSignals, env }).catch(error => ({ rejectedOnly: true, bot, pair, reason: error.message })));
    }
  }
  const settled = await Promise.allSettled(jobs);
  const candidates = [];
  const rejected = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value?.rejectedOnly) rejected.push({ bot: result.value.bot.name, pair: result.value.pair, reason: result.value.reason });
    else if (result.status === 'fulfilled') candidates.push(result.value);
    else rejected.push({ reason: result.reason?.message || 'error evaluando par' });
  }
  const created = [];
  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    if (item.status !== 'new') { rejected.push({ bot: item.bot.name, pair: item.pair, reason: item.reason }); continue; }
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
      status: 'new',
      expires_at: expiresAt,
      min_required_quote: Number(item.minQuote.toFixed(8)),
      available_quote: Number(item.plan.balanceQuote.toFixed(8)),
      order_quote: Number(item.plan.orderQuote.toFixed(8)),
      spread_pct: Number(item.ticker.spreadPct.toFixed(4)),
      volume_score: item.liquidity.score,
      raw_data: JSON.stringify({ masterStrategy: MASTER_STRATEGY, profile: item.plan.profile, scoreComponents: item.technical.scoreComponents, scannedPairs: SUPPORTED_PAIRS, avgQuoteVolume5m: item.liquidity.avgQuoteVolume, balanceQuote: item.plan.balanceQuote, exposureQuote: item.plan.exposure, maxQuote: env.maxQuote, minReservedQuote: env.minReservedQuote })
    });
    created.push(signal);
  }
  const summary = { scannerTick: now.toISOString(), scannedPairs: SUPPORTED_PAIRS, scannedBots: liveBots.length, evaluations: settled.length, signalsCreated: created.length, signalsRejected: rejected.length, reasons: rejected.slice(0, 10), bestSignals: created.slice(0, 5) };
  if (liveSession?.id) await entities.BotSession.update(liveSession.id, { last_scanner_at: summary.scannerTick, last_error: created.length ? '' : (summary.reasons[0]?.reason || '') });
  return summary;
}

async function getRiskConfig(entities) {
  try {
    const rows = await entities.RiskConfig.list('-created_date', 1);
    const record = (Array.isArray(rows) ? rows : rows?.items || [])[0] || {};
    return { ...DEFAULT_RISK, ...record };
  } catch { return { ...DEFAULT_RISK }; }
}

async function ensureExchangeStop({ entities, trade, rules, stopPrice }) {
  const pair = normalizePair(trade.pair);
  const volume = Number(trade.amount || trade.executed_volume || 0);
  const price = Number(stopPrice || trade.stop_loss || 0);
  if (!volume || !price) return { ok: false, reason: 'trade sin volumen o stop válido' };
  let lastError = 'sin intentos';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await placeStopLossOrder(pair, volume, price, rules.pair_decimals);
      const txid = Array.isArray(response.txid) ? response.txid[0] : '';
      if (!txid) throw new Error('Kraken no devolvió txid del stop-loss');
      const tickedStop = Number(roundTick(price, rules.pair_decimals));
      await entities.Trade.update(trade.id, { exchange_stop_txid: txid, stop_loss: tickedStop });
      await createAlert(entities, 'Stop-loss colocado en Kraken', `${trade.bot_name} · ${displayPair(pair)} ${volume} @ ${tickedStop} · ${txid}`, 'success');
      return { ok: true, txid, stopPrice: tickedStop, attempts: attempt };
    } catch (error) {
      lastError = error.message;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  return { ok: false, reason: lastError, attempts: 2 };
}

async function marketCloseAndRecord({ entities, trade, pair, reason, tickId: loopId }) {
  const ticker = await getTicker(pair);
  const closed = await closeTradeMarket(trade, ticker.price, 1, entities);
  const entryCost = Number(trade.cost || (Number(trade.entry_price || 0) * Number(trade.amount || 0)));
  const entryFee = Number(trade.fee || trade.fees || 0);
  const closeCost = Number(closed.execution.cost || 0);
  const closeFee = Number(closed.execution.fee || 0);
  const pnl = trade.side === 'buy' ? closeCost - entryCost - entryFee - closeFee : entryCost - closeCost - entryFee - closeFee;
  const pnlPct = entryCost ? (pnl / entryCost) * 100 : 0;
  const stamp = new Date().toISOString();
  await entities.Trade.update(trade.id, { status: 'closed', exit_price: closed.execution.executed_price, close_executed_price: closed.execution.executed_price, close_executed_volume: closed.execution.executed_volume, close_fee: closeFee, close_cost: closeCost, close_txid: closed.execution.txid, exit_date: stamp, profit_loss: Number(pnl.toFixed(8)), profit_loss_percent: Number(pnlPct.toFixed(4)), close_order_id: closed.execution.txid, closed_by_tick_id: loopId, last_error: '', notes: `LIVE cerrado a mercado: ${reason}` });
  await createAlert(entities, 'Posición cerrada a mercado', `${trade.bot_name} cerró ${displayPair(pair)} · ${reason} · PnL ${pnl.toFixed(6)} EUR`, pnl >= 0 ? 'warning' : 'critical');
  return { pnl: Number(pnl.toFixed(8)), pnlPercent: Number(pnlPct.toFixed(4)), closeOrderId: closed.execution.txid };
}

async function verifyOpenStops({ entities, openTrades, tickId: loopId }) {
  const report = [];
  const closedIds = [];
  if (!openTrades.length) return { report, closedIds };
  let openOrders = {};
  try { openOrders = await getOpenOrders(); }
  catch (error) { return { report: [{ ok: false, reason: `OpenOrders no disponible: ${error.message}` }], closedIds }; }
  for (const trade of openTrades) {
    const pair = normalizePair(trade.pair);
    const txid = trade.exchange_stop_txid || '';
    if (txid && openOrders[txid]) { report.push({ tradeId: trade.id, pair: displayPair(pair), ok: true, txid }); continue; }
    // El stop no está abierto: puede que Kraken ya lo haya EJECUTADO. Comprobarlo antes de
    // recolocar nada, para no vender saldo que ya no pertenece a este trade.
    if (txid) {
      try {
        const order = await queryOrder(txid);
        const executed = Number(order?.vol_exec || 0);
        if (order && order.status === 'closed' && executed > 0) {
          const entryCost = Number(trade.cost || (Number(trade.entry_price || 0) * Number(trade.amount || 0)));
          const entryFee = Number(trade.fee || trade.fees || 0);
          const closeCost = Number(order.cost || 0);
          const closeFee = Number(order.fee || 0);
          const exitPrice = Number(order.price || 0) || (executed ? closeCost / executed : 0);
          const pnl = closeCost - entryCost - entryFee - closeFee;
          const pnlPct = entryCost ? (pnl / entryCost) * 100 : 0;
          await entities.Trade.update(trade.id, { status: 'closed', exit_price: exitPrice, close_executed_price: exitPrice, close_executed_volume: executed, close_fee: closeFee, close_cost: closeCost, close_txid: txid, close_order_id: txid, exit_date: new Date().toISOString(), profit_loss: Number(pnl.toFixed(8)), profit_loss_percent: Number(pnlPct.toFixed(4)), closed_by_tick_id: loopId, last_error: '', notes: 'LIVE cerrado por el stop-loss de Kraken' });
          await createAlert(entities, 'Stop-loss ejecutado en Kraken', `${trade.bot_name} · ${displayPair(pair)} · PnL ${pnl.toFixed(6)} EUR`, 'warning');
          closedIds.push(trade.id);
          report.push({ tradeId: trade.id, pair: displayPair(pair), ok: true, closedByStop: true, pnl });
          continue;
        }
      } catch (error) {
        // Sin poder saber si el stop se ejecutó, no tocar nada este ciclo
        await entities.Trade.update(trade.id, { last_error: `no se pudo consultar el stop ${txid}: ${error.message}` });
        report.push({ tradeId: trade.id, pair: displayPair(pair), ok: false, reason: `consulta del stop fallida: ${error.message}` });
        continue;
      }
    }
    const rules = await getAssetPairRules(pair);
    const stop = await ensureExchangeStop({ entities, trade, rules, stopPrice: Number(trade.stop_loss || 0) });
    if (stop.ok) { report.push({ tradeId: trade.id, pair: displayPair(pair), ok: true, recreated: true, txid: stop.txid }); continue; }
    try {
      const closed = await marketCloseAndRecord({ entities, trade, pair, reason: `sin stop-loss en Kraken y no se pudo recrear (${stop.reason})`, tickId: loopId });
      closedIds.push(trade.id);
      report.push({ tradeId: trade.id, pair: displayPair(pair), ok: false, closedAtMarket: true, reason: stop.reason, ...closed });
    } catch (error) {
      await entities.Trade.update(trade.id, { last_error: `sin stop-loss: ${error.message}` });
      report.push({ tradeId: trade.id, pair: displayPair(pair), ok: false, reason: `${stop.reason} · cierre fallido: ${error.message}` });
    }
  }
  return { report, closedIds };
}

async function dailyLimits(entities, riskConfig) {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const liveTrades = await entities.Trade.filter({ mode: 'live' }, '-created_date', 100);
  const todayTrades = liveTrades.filter(trade => new Date(trade.entry_date || trade.created_date).getTime() >= since.getTime());
  if (todayTrades.length >= Number(riskConfig.max_trades_per_day || 3)) return { ok: false, reason: `máximo ${riskConfig.max_trades_per_day} trades al día alcanzado` };
  // Pérdida máxima del día: lo perdido en los cerrados + lo que pueden perder los abiertos en su stop
  const realized = todayTrades.reduce((sum, trade) => sum + Math.min(0, Number(trade.profit_loss || 0)), 0);
  const openRisk = todayTrades.filter(trade => trade.status === 'open').reduce((sum, trade) => sum + Math.max(0, (Number(trade.entry_price || 0) - Number(trade.stop_loss || 0)) * Number(trade.amount || 0)), 0);
  return { ok: true, used: Math.abs(realized) + openRisk, count: todayTrades.length };
}

// Puerta de riesgo para señales DayTrader: re-dimensiona con el precio FRESCO y comprueba los límites
async function riskGateDayTrader({ entities, riskConfig, pair, balances, ticker, rules, takerFeePct, dayTrader }) {
  const cfg = { ...DT_DEFAULTS, ...riskConfig };
  if (!inEntryWindow(Date.now(), cfg)) return { ok: false, reason: 'fuera de la ventana de entrada' };
  const market = agentMarketMonitor({ ticker, rules, cfg });
  if (!market.ok) return { ok: false, reason: market.reason };
  const capitalEUR = getCapitalEUR(balances);
  const budget = agentBudget({ plan: dayTrader.plan, ask: ticker.ask, feePct: takerFeePct, capitalEUR, rules, riskConfig, cfg });
  if (!budget.ok) return { ok: false, reason: budget.reason };
  const day = await dailyLimits(entities, riskConfig);
  if (!day.ok) return { ok: false, reason: day.reason };
  if (day.used + budget.maxLossEUR > Number(riskConfig.max_daily_loss_eur || 0)) return { ok: false, reason: `pérdida máxima del día: ${day.used.toFixed(4)} € usados + ${budget.maxLossEUR} € de esta > ${riskConfig.max_daily_loss_eur} €` };
  return { ok: true, capitalEUR, orderQuote: budget.orderEUR, minQuote: minRequiredQuote(rules, ticker.price), volume: budget.qty, profile: { name: 'day_trader' }, exposure: 0, rewardRisk: { ok: true, ratio: budget.netRR }, lossPerTrade: budget.maxLossEUR, plan: dayTrader.plan, budget };
}

async function riskGate({ entities, riskConfig, bot, session, pair, balances, openTrades, ticker, rules, signal, profile, takerFeePct, dayTrader = null }) {
  if (riskConfig.kill_switch) return { ok: false, reason: 'kill_switch activo en RiskConfig' };
  if (bot.status !== 'active' || bot.trading_mode !== 'live' || bot.live_enabled !== true) return { ok: false, reason: 'Bot no está LIVE activo' };
  if (!session || session.active !== true || session.mode !== 'live') return { ok: false, reason: 'No hay BotSession LIVE activa' };
  if (bot.cooldown_until && new Date(bot.cooldown_until).getTime() > Date.now()) return { ok: false, reason: `Cooldown activo hasta ${bot.cooldown_until}` };
  if (openTrades.length >= Number(riskConfig.max_open_trades || 1)) return { ok: false, reason: `límite de ${riskConfig.max_open_trades} trade(s) abierto(s)` };
  if (openTrades.some(trade => normalizePair(trade.pair) === normalizePair(pair))) return { ok: false, reason: 'ya existe trade abierto del mismo par' };
  if (String(rules.status || 'online') !== 'online') return { ok: false, reason: `par ${displayPair(pair)} no está online en Kraken` };
  if (ticker.spreadPct > 0.25) return { ok: false, reason: 'spread alto' };
  if (dayTrader) return riskGateDayTrader({ entities, riskConfig, pair, balances, ticker, rules, takerFeePct, dayTrader });
  if (!profile.pairs.includes(normalizePair(pair))) return { ok: false, reason: `perfil ${profile.name}: par no prioritario` };
  if (signal && Number(signal.score || 0) < profile.minScore) return { ok: false, reason: `score ${signal.score} inferior al mínimo ${profile.minScore} del perfil ${profile.name}` };

  const capitalEUR = getCapitalEUR(balances);
  const exposure = quoteExposure(openTrades, 'EUR');
  const spendable = Math.max(0, capitalEUR - 4);
  const budgetLeft = Math.max(0, (capitalEUR + exposure) * 0.8 - exposure);
  const orderQuote = Math.min(Number(bot.max_order_quote || bot.max_order_usd || spendable), spendable, budgetLeft);
  const minQuote = minRequiredQuote(rules, ticker.price);
  const volume = roundDown(orderQuote / ticker.price, rules.lot_decimals);
  if (orderQuote <= 0) return { ok: false, reason: `capital EUR insuficiente (${capitalEUR.toFixed(4)} €)`, capitalEUR };
  if (volume < rules.ordermin || orderQuote < rules.costmin) return { ok: false, reason: `por debajo del ordermin/costmin de ${displayPair(pair)}`, orderQuote, minQuote, volume };

  const risk = adjustedRisk(bot.strategy || signal?.strategy || 'default', ticker.spreadPct, profile, takerFeePct);
  const lossPct = risk.stopLossPct + risk.estimatedRoundTripFeesPct + ticker.spreadPct;
  const lossPerTrade = (orderQuote * lossPct) / 100;
  if (lossPerTrade > Number(riskConfig.max_loss_per_trade_eur || 0)) return { ok: false, reason: `pérdida potencial ${lossPerTrade.toFixed(4)} € > máximo ${riskConfig.max_loss_per_trade_eur} €`, lossPerTrade, orderQuote };
  const rr = rewardRisk({ takeProfitPct: risk.takeProfitPct, stopLossPct: risk.stopLossPct, roundTripFeePct: risk.estimatedRoundTripFeesPct, spreadPct: ticker.spreadPct, minRewardRisk: Number(riskConfig.min_reward_risk || 1.5) });
  if (!rr.ok) return { ok: false, reason: `beneficio/riesgo ${rr.ratio} por debajo de ${riskConfig.min_reward_risk} tras comisiones`, rewardRisk: rr };

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const liveTrades = await entities.Trade.filter({ mode: 'live' }, '-created_date', 100);
  const todayTrades = liveTrades.filter(trade => new Date(trade.entry_date || trade.created_date).getTime() >= since.getTime());
  if (todayTrades.length >= Number(riskConfig.max_trades_per_day || 3)) return { ok: false, reason: `máximo ${riskConfig.max_trades_per_day} trades al día alcanzado` };
  const dailyLoss = todayTrades.reduce((sum, trade) => sum + Math.min(0, Number(trade.profit_loss || 0)), 0);
  if (Math.abs(dailyLoss) >= Number(riskConfig.max_daily_loss_eur || 0)) return { ok: false, reason: `pérdida diaria ${Math.abs(dailyLoss).toFixed(4)} € >= máximo ${riskConfig.max_daily_loss_eur} €` };

  const candles = await getCandles(pair, 5);
  const liquidity = liquidityCheck(candles, ticker, minQuote);
  if (!liquidity.ok) return { ok: false, reason: liquidity.reason };

  return { ok: true, capitalEUR, orderQuote, minQuote, volume, liquidity, profile, exposure, risk, rewardRisk: rr, lossPerTrade };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// AGENTES "DAY TRADER" (adaptado de github.com/Jakeschincariol/day-trader-skill, MIT)
// a cripto spot en Kraken, cuenta en EUR. Cadena por par:
//   Monitor de mercado → Temporizador de entrada (ORB) → Planificador de salida →
//   Máquina del Tiempo → Gestor de presupuesto → (riskGate) → Ejecutor con stop en Kraken
// Cada agente puede rechazar y explica por qué. Nada aquí promete ganancias.
// ═══════════════════════════════════════════════════════════════════════════════════════
const DT_DEFAULTS = {
  strategy_engine: 'day_trader',      // 'day_trader' | 'sentinel' (motor anterior por score)
  session_anchor_utc_hour: 7,         // inicio de la "sesión" diaria (07:00 UTC = 08:00 en España)
  or_minutes: 15,                     // rango de apertura: primeras 3 velas de 5 min
  entry_window_utc_start: '07:15',
  entry_window_utc_end: '19:00',
  stop_rule: 'or-low',                // 'or-low' (más ancho: menos comisiones relativas) | 'or-mid'
  target_r: 3,
  min_volume_x: 1.0,                  // volumen de la vela de disparo ≥ X × media del rango
  max_fee_r: 0.5,                     // las comisiones+spread no pueden costar más de 0,5 R
  tm_runs: 10000,
  tm_seed: 19,
  tm_min_edge_points: 5,              // la Máquina del Tiempo debe dar ≥5 puntos sobre el equilibrio
  moving_block_pct: 8,                // no entrar si el par se mueve ±8 % en el día (noticia/volatilidad)
  max_position_pct: 85,
  cash_buffer_pct: 10
};

function hmToMinutes(value) { const [h, m] = String(value || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function utcMinutes(ms) { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function sessionAnchorMs(nowMs, hour) { const d = new Date(nowMs); const anchor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0); return anchor > nowMs ? anchor - 86400000 : anchor; }
function inEntryWindow(ms, cfg) { const m = utcMinutes(ms); return m >= hmToMinutes(cfg.entry_window_utc_start) && m <= hmToMinutes(cfg.entry_window_utc_end); }
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Agente: Monitor de mercado (sustituto cripto del monitor de noticias + "halt")
function agentMarketMonitor({ ticker, rules, cfg }) {
  if (String(rules.status || 'online') !== 'online') return { ok: false, reason: `HALT: el par está "${rules.status}" en Kraken` };
  if (Math.abs(ticker.changePct) >= cfg.moving_block_pct) return { ok: false, reason: `MOVING ${ticker.changePct.toFixed(2)} % hoy: movimiento anómalo, posible noticia; no se entra` };
  return { ok: true, changePct: Number(ticker.changePct.toFixed(2)) };
}

// Agente: Temporizador de entrada — ruptura del rango de apertura, solo velas CERRADAS
function agentEntry({ candles, cfg, nowMs }) {
  const anchor = sessionAnchorMs(nowMs, cfg.session_anchor_utc_hour);
  const orEnd = anchor + cfg.or_minutes * 60000;
  if (nowMs < orEnd + 5 * 60000) return { status: 'forming', reason: 'el rango de apertura aún se está formando' };
  const expected = Math.round(cfg.or_minutes / 5);
  const range = candles.filter(c => c.time * 1000 >= anchor && c.time * 1000 < orEnd);
  if (range.length < expected) return { status: 'no_data', reason: `rango incompleto (${range.length}/${expected} velas)` };
  const rangeHigh = Math.max(...range.map(c => c.high));
  const rangeLow = Math.min(...range.map(c => c.low));
  const avgVol = average(range.map(c => c.volume));
  const after = candles.filter(c => c.time * 1000 >= orEnd);
  const idx = after.findIndex(c => c.close > rangeHigh && (cfg.min_volume_x <= 0 || c.volume >= cfg.min_volume_x * avgVol));
  if (idx < 0) { const last = after.at(-1); return { status: 'waiting', rangeHigh, rangeLow, reason: `esperando: último cierre ${last?.close ?? '—'} bajo el máximo del rango ${rangeHigh}` }; }
  const bar = after[idx];
  const triggerMs = bar.time * 1000 + 5 * 60000;
  // Un solo disparo por día: el primero. Si no es la última vela cerrada, ya es tarde (otra operación)
  if (idx < after.length - 1) return { status: 'stale', rangeHigh, rangeLow, reason: `el disparo fue a las ${new Date(triggerMs).toISOString().slice(11, 16)} UTC; entrar ahora sería tarde` };
  if (!inEntryWindow(triggerMs, cfg)) return { status: 'expired', rangeHigh, rangeLow, reason: 'disparo fuera de la ventana de entrada' };
  return { status: 'triggered', entry: bar.close, rangeHigh, rangeLow, triggerTime: new Date(triggerMs).toISOString(), volumeX: avgVol ? Number((bar.volume / avgVol).toFixed(2)) : null, reason: `cierre ${bar.close} por encima del rango ${rangeHigh}` };
}

// Agente: Planificador de salida — stop y objetivo ANTES de entrar
function agentExit({ entry, rangeHigh, rangeLow, decimals, feePct, spreadPct, cfg }) {
  const factor = 10 ** Number(decimals ?? 2);
  const rawStop = cfg.stop_rule === 'or-mid' ? (rangeHigh + rangeLow) / 2 : rangeLow;
  const stop = Math.floor(rawStop * factor) / factor;            // redondeo alejándose de la entrada
  if (stop >= entry) return { ok: false, reason: 'stop en la entrada o por encima' };
  const risk = entry - stop;
  const target = Math.round((entry + cfg.target_r * risk) * factor) / factor;
  if (target <= entry) return { ok: false, reason: 'objetivo en la entrada o por debajo' };
  const costPerUnit = entry * (2 * feePct + spreadPct) / 100;   // comisiones ida+vuelta + spread
  const feeR = costPerUnit / risk;
  if (feeR > cfg.max_fee_r) return { ok: false, reason: `comisiones+spread cuestan ${feeR.toFixed(2)} R (máx ${cfg.max_fee_r}): el rango es demasiado estrecho para las comisiones` };
  return { ok: true, entry, stop, target, risk, riskPct: Number((risk / entry * 100).toFixed(3)), targetR: cfg.target_r, feeR: Number(feeR.toFixed(3)), stopRule: cfg.stop_rule };
}

// Agente: Máquina del Tiempo — 10.000 simulaciones con velas reales de la misma hora del día
function agentTimeMachine({ plan, candles, intervalMin, nowMs, maxHoldMin, cfg }) {
  const slots = Math.round(1440 / intervalMin);
  const anchorToday = sessionAnchorMs(nowMs, cfg.session_anchor_utc_hour);
  const slotOf = ms => Math.floor((((ms - anchorToday) % 86400000) + 86400000) % 86400000 / (intervalMin * 60000));
  const bySession = new Map();
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]; const prev = candles[i - 1];
    if (c.time - prev.time !== intervalMin * 60) continue;           // solo velas contiguas
    const ms = c.time * 1000;
    if (ms >= anchorToday) continue;                                  // nunca mezclar el día de hoy
    const session = Math.floor((ms - anchorToday) / 86400000);
    if (!bySession.has(session)) bySession.set(session, []);
    bySession.get(session).push({ slot: slotOf(ms), r: [c.open / prev.close, c.high / prev.close, c.low / prev.close, c.close / prev.close] });
  }
  const full = [...bySession.values()].filter(rows => rows.length === slots);
  if (full.length < 20) return { ok: false, reason: `solo ${full.length} sesiones completas (mínimo 20): sin datos suficientes para simular` };
  const pool = Array.from({ length: slots }, () => []);
  for (const rows of full) for (const row of rows) pool[row.slot].push(row.r);
  const steps = Math.max(1, Math.floor(maxHoldMin / intervalMin));
  const startSlot = slotOf(nowMs);
  const rand = mulberry32(cfg.tm_seed);
  const { entry, stop, target, risk, feeR, targetR } = plan;
  let tFirst = 0, sFirst = 0, neither = 0, sumR = 0; const finals = [];
  for (let run = 0; run < cfg.tm_runs; run++) {
    let p = entry; let outcome = 0;
    for (let k = 0; k < steps; k++) {
      const slot = (startSlot + k) % slots;
      const near = pool[(slot + Math.floor(rand() * 5) - 2 + slots) % slots];
      const r = near[Math.floor(rand() * near.length)];
      const low = p * r[2]; const high = p * r[1];
      if (low <= stop) { outcome = -1; break; }                       // si toca ambos, cuenta como stop
      if (high >= target) { outcome = 1; break; }
      p *= r[3];
    }
    if (outcome === 1) { tFirst++; sumR += targetR - feeR; finals.push(target); }
    else if (outcome === -1) { sFirst++; sumR += -1 - feeR; finals.push(stop); }
    else { neither++; sumR += (p - entry) / risk - feeR; finals.push(p); }
  }
  finals.sort((a, b) => a - b);
  const runs = cfg.tm_runs; const hits = tFirst + sFirst;
  const pTarget = hits ? tFirst / hits : 0;
  const breakeven = (1 + feeR) / (1 + targetR);                       // con comisiones
  const edge = (pTarget - breakeven) * 100;
  const avgNetR = sumR / runs;
  const verdict = Math.abs(edge) < 5 ? (targetR === 1 ? 'Cerca de cara o cruz' : 'Cerca del equilibrio') : edge >= 15 ? 'Fuertemente hacia el objetivo' : edge >= 5 ? 'Se inclina al objetivo' : edge <= -15 ? 'Fuertemente hacia el stop' : 'Se inclina al stop';
  const ok = edge >= cfg.tm_min_edge_points && avgNetR > 0;
  return {
    ok, verdict, seed: cfg.tm_seed, runs, sessions: full.length, intervalMin,
    targetFirstPct: Number((tFirst / runs * 100).toFixed(1)), stopFirstPct: Number((sFirst / runs * 100).toFixed(1)), neitherPct: Number((neither / runs * 100).toFixed(1)),
    breakevenPct: Number((breakeven * 100).toFixed(1)), targetShareOfHitsPct: Number((pTarget * 100).toFixed(1)), edgePoints: Number(edge.toFixed(1)), avgNetR: Number(avgNetR.toFixed(3)),
    p5: finals[Math.floor(runs * 0.05)], median: finals[Math.floor(runs / 2)], p95: finals[Math.floor(runs * 0.95)],
    reason: ok ? `${verdict}: ${(pTarget * 100).toFixed(1)} % objetivo vs ${(breakeven * 100).toFixed(1)} % necesario, R medio neto ${avgNetR.toFixed(3)}` : `${verdict} (${edge.toFixed(1)} puntos, R medio neto ${avgNetR.toFixed(3)}): no compensa`
  };
}

// Agente: Gestor de presupuesto — tamaño = el menor de 4 límites, comisiones incluidas
function agentBudget({ plan, ask, feePct, capitalEUR, rules, riskConfig, cfg }) {
  const entry = Math.max(plan.entry, ask);                            // si el precio subió, más riesgo → menos unidades
  const riskPerUnit = entry - plan.stop;
  if (riskPerUnit <= 0) return { ok: false, reason: 'el precio ya está en el stop o por debajo' };
  const feePerUnit = entry * 2 * feePct / 100;
  const limits = {
    perdida_maxima: Number(riskConfig.max_loss_per_trade_eur || 0) / (riskPerUnit + feePerUnit),
    tope_posicion: capitalEUR * cfg.max_position_pct / 100 / entry,
    orden_maxima: Number(riskConfig.max_order_eur || Infinity) / entry,
    efectivo: capitalEUR * (1 - cfg.cash_buffer_pct / 100) / entry
  };
  const decidedBy = Object.entries(limits).sort((a, b) => a[1] - b[1])[0][0];
  const qty = roundDown(Math.max(0, Math.min(...Object.values(limits))), rules.lot_decimals);
  if (!qty || qty < rules.ordermin || qty * entry < rules.costmin) return { ok: false, reason: `tamaño ${qty} por debajo del mínimo de Kraken (decide: ${decidedBy})`, decidedBy };
  const netRR = ((plan.target - entry) - feePerUnit) / (riskPerUnit + feePerUnit);
  if (netRR < Number(riskConfig.min_reward_risk || 1.5)) return { ok: false, reason: `beneficio/riesgo neto ${netRR.toFixed(2)} < ${riskConfig.min_reward_risk}: el movimiento ya ha ocurrido en parte` };
  return { ok: true, qty, entry, orderEUR: Number((qty * entry).toFixed(4)), maxLossEUR: Number((qty * (riskPerUnit + feePerUnit)).toFixed(4)), netRR: Number(netRR.toFixed(2)), decidedBy };
}

function pickDayTraderBot(liveBots) { return liveBots.find(bot => /trend/i.test(bot.name || '')) || liveBots.find(bot => !/guardian/i.test(bot.name || '')) || liveBots[0]; }

// Escáner + cadena de agentes para cada par. Crea una Signal solo si TODOS los agentes aprueban.
async function runDayTraderScanner(entities, liveSession, liveBots, balances, openTrades, riskConfig) {
  const cfg = { ...DT_DEFAULTS, ...riskConfig };
  const nowMs = Date.now();
  const bot = pickDayTraderBot(liveBots);
  const expiresAt = new Date(nowMs + 3 * 60 * 1000).toISOString();
  const report = []; const created = [];
  if (!bot) return { scannerTick: new Date(nowMs).toISOString(), engine: 'day_trader', signalsCreated: 0, signalsRejected: 0, reasons: [{ reason: 'no hay bot LIVE activo' }] };
  for (const pair of SUPPORTED_PAIRS) {
    const entryLog = { pair: displayPair(pair) };
    try {
      if (openTrades.some(trade => normalizePair(trade.pair) === pair)) throw new Error('ya hay un trade abierto en este par');
      const [ticker, rules, candles] = await Promise.all([getTicker(pair), getAssetPairRules(pair), getCandles(pair, 5, 288)]);
      const market = agentMarketMonitor({ ticker, rules, cfg });
      if (!market.ok) throw new Error(`Monitor: ${market.reason}`);
      const entry = agentEntry({ candles, cfg, nowMs });
      entryLog.entry = entry.status;
      if (entry.status !== 'triggered') throw new Error(`Entrada: ${entry.reason}`);
      const feePct = await getTakerFeePct(pair);
      const plan = agentExit({ entry: entry.entry, rangeHigh: entry.rangeHigh, rangeLow: entry.rangeLow, decimals: rules.pair_decimals, feePct, spreadPct: ticker.spreadPct, cfg });
      if (!plan.ok) throw new Error(`Salida: ${plan.reason}`);
      const hourly = await getCandles(pair, 60, 720);
      const tm = agentTimeMachine({ plan, candles: hourly, intervalMin: 60, nowMs, maxHoldMin: Number(cfg.max_hold_minutes || DEFAULT_RISK.max_hold_minutes), cfg });
      entryLog.timeMachine = tm.reason;
      if (!tm.ok) throw new Error(`Máquina del Tiempo: ${tm.reason}`);
      const budget = agentBudget({ plan, ask: ticker.ask, feePct, capitalEUR: getCapitalEUR(balances), rules, riskConfig, cfg });
      if (!budget.ok) throw new Error(`Presupuesto: ${budget.reason}`);
      const dayTrader = { market, entry, plan, timeMachine: tm, budget, feePct };
      const signal = await entities.Signal.create({
        bot_name: bot.name, bot_id: bot.id, strategy: 'DayTrader ORB', exchange: 'kraken', pair, side: 'buy',
        confidence: Math.min(0.99, Number((0.6 + tm.edgePoints / 100).toFixed(2))), score: Math.min(100, Math.round(70 + tm.edgePoints)),
        reason: `DayTrader ORB · ${entry.reason} · stop ${plan.stop} · objetivo ${plan.target} (${plan.targetR}R) · ${tm.reason} · ${budget.qty} uds (${budget.orderEUR} €, pérdida máx ${budget.maxLossEUR} €)`,
        price: ticker.price, timeframe: '5m', status: 'new', expires_at: expiresAt,
        min_required_quote: Number(minRequiredQuote(rules, ticker.price).toFixed(8)), available_quote: Number(getCapitalEUR(balances).toFixed(8)), order_quote: budget.orderEUR,
        spread_pct: Number(ticker.spreadPct.toFixed(4)), volume_score: 0, raw_data: JSON.stringify({ dayTrader })
      });
      await createAlert(entities, `DayTrader: señal en ${displayPair(pair)}`, signal.reason, 'info');
      created.push(signal);
      report.push({ ...entryLog, ok: true });
    } catch (error) {
      report.push({ ...entryLog, ok: false, reason: error.message });
    }
  }
  const summary = { scannerTick: new Date(nowMs).toISOString(), engine: 'day_trader', scannedPairs: SUPPORTED_PAIRS, scannedBots: 1, evaluations: SUPPORTED_PAIRS.length, signalsCreated: created.length, signalsRejected: report.filter(r => !r.ok).length, reasons: report.filter(r => !r.ok).map(r => ({ pair: r.pair, reason: r.reason })), agents: report };
  if (liveSession?.id) await entities.BotSession.update(liveSession.id, { last_scanner_at: summary.scannerTick, last_error: '' });
  return summary;
}

function parseDayTrader(signal) { try { return JSON.parse(signal?.raw_data || '{}').dayTrader || null; } catch { return null; } }

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

    let env = envConfig();
    try { env = applyDynamicCapitalEnv(env, await getBalances()); } catch { env = applyDynamicCapitalEnv(env, null); }
    const sessions = await entities.BotSession.filter({ active: true }, '-created_date', 5);
    const liveSession = sessions.find(session => session.mode === 'live');
    const bots = await entities.Bot.list();
    const liveBots = bots.filter(bot => bot.status === 'active' && bot.trading_mode === 'live' && bot.live_enabled === true && (bot.exchange || 'kraken') === 'kraken');

    if (validateOnly) return Response.json({ ok: env.ok, ...env, masterStrategy: MASTER_STRATEGY.version, dynamicProfiles: ['micro:65', 'pequeño:70', 'medio:75', 'alto:80', 'institucional:85'], liveSession: !!liveSession, liveBots: liveBots.length, supportedPairs: SUPPORTED_PAIRS, message: env.ok ? 'tradingLoop LIVE con capital concentrado dinámico activo' : 'Entorno LIVE incompleto o bloqueado' });
    assertLiveEnv();
    if (!liveSession) return Response.json({ ok: true, skipped: true, reason: 'No hay BotSession LIVE activa', tickId: id });
    if (!runOnce && !autoMode && !forceClose) return Response.json({ error: 'Payload inválido: usa runOnce, autoMode, forceClose o validateOnly' }, { status: 400 });
    if (!liveBots.length && !forceClose) return Response.json({ ok: true, skipped: true, reason: 'No hay bots LIVE activos', tickId: id });

    // Marca de inicio: si el ciclo se corta por tiempo, el panel lo detecta como ciclo no completado
    try { await entities.BotSession.update(liveSession.id, { last_cycle_started_at: new Date().toISOString(), last_cycle_status: 'running' }); } catch {}

    const nowIso = new Date().toISOString();
    const results = [];
    let balances = await getBalances();
    env = applyDynamicCapitalEnv(env, balances);
    let openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);
    const riskConfig = await getRiskConfig(entities);
    // Al inicio de cada ciclo: cada trade abierto debe tener su stop-loss vivo en Kraken
    const stopCheck = await verifyOpenStops({ entities, openTrades, tickId: id });
    results.push(...stopCheck.report.map(item => ({ action: 'stop_check', ...item })));
    openTrades = openTrades.filter(trade => !stopCheck.closedIds.includes(trade.id));
    const engine = String(riskConfig.strategy_engine || DT_DEFAULTS.strategy_engine);
    const scanner = forceClose ? { scannerTick: nowIso, scannedPairs: SUPPORTED_PAIRS, scannedBots: liveBots.length, evaluations: 0, signalsCreated: 0, signalsRejected: 0, reasons: [] }
      : engine === 'day_trader' ? await runDayTraderScanner(entities, liveSession, liveBots, balances, openTrades, riskConfig)
      : await runScanner(entities, liveSession, liveBots, balances, openTrades, env);
    let freshSignals = await getFreshSignals(entities);
    const signalStats = { signalsAccepted: 0, signalsRejected: 0, tradesOpened: 0, tradesClosed: 0, reasons: [] };

    for (const trade of openTrades) {
      const pair = normalizePair(trade.pair);
      const bot = bots.find(item => item.name === trade.bot_name);
      try {
        const ticker = await getTicker(pair);
        let decision = shouldCloseTrade(trade, ticker, forceClose, riskConfig);
        const contrarySignal = freshSignals.find(signal => signal.side === 'sell' && signal.bot_id === bot?.id && normalizePair(signal.pair) === pair);
        if (!decision.close && contrarySignal) decision = { close: true, reason: `Señal contraria del mismo bot: ${contrarySignal.reason}`, signalId: contrarySignal.id };
        if (!decision.close) { results.push({ action: 'monitoring', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), price: ticker.price, pnlPercent: decision.pnlPct, reason: decision.reason }); continue; }
        const closed = await closeTradeMarket(trade, ticker.price, 1, entities);
        const closeOrderId = closed.execution.txid;
        const entryCost = Number(trade.cost || (Number(trade.entry_price || 0) * Number(trade.amount || 0)));
        const entryFee = Number(trade.fee || trade.fees || 0);
        const closeCost = Number(closed.execution.cost || 0);
        const closeFee = Number(closed.execution.fee || 0);
        const pnl = trade.side === 'buy' ? closeCost - entryCost - entryFee - closeFee : entryCost - closeCost - entryFee - closeFee;
        const pnlPct = entryCost ? (pnl / entryCost) * 100 : 0;
        await entities.Trade.update(trade.id, { status: 'closed', exit_price: closed.execution.executed_price, close_executed_price: closed.execution.executed_price, close_executed_volume: closed.execution.executed_volume, close_fee: closeFee, close_cost: closeCost, close_txid: closeOrderId, exit_date: nowIso, profit_loss: Number(pnl.toFixed(8)), profit_loss_percent: Number(pnlPct.toFixed(4)), close_order_id: closeOrderId, closed_by_tick_id: id, raw_response: JSON.stringify({ open: trade.raw_response || '', close: closed.response, closeExecution: closed.execution.raw_order }), last_error: '', notes: `LIVE cerrado: ${decision.reason}` });
        await createAlert(entities, 'Orden LIVE cerrada', `${trade.bot_name} cerró ${displayPair(pair)} · PnL ${pnl.toFixed(6)}`, pnl >= 0 ? 'success' : 'warning');
        if (decision.signalId) await markSignal(entities, { id: decision.signalId }, 'executed', 'executed: cierre por señal contraria');
        if (bot?.id) await safeBotUpdate(entities, bot.id, { last_run_at: nowIso, last_signal: `closed: ${decision.reason}`, last_error: '', cooldown_until: new Date(Date.now() + 60_000).toISOString() });
        signalStats.tradesClosed += 1;
        results.push({ action: 'closed', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), exitPrice: closed.execution.executed_price, executedVolume: closed.execution.executed_volume, fee: closeFee, cost: closeCost, pnl, pnlPercent: pnlPct, closeOrderId, rawResponse: closed.response });
      } catch (error) {
        await entities.Trade.update(trade.id, { status: 'open', last_error: error.message });
        if (bot?.id) await safeBotUpdate(entities, bot.id, { last_run_at: nowIso, last_error: error.message });
        await createAlert(entities, 'Error cerrando operación LIVE', `${trade.bot_name}: ${error.message}`, 'critical');
        results.push({ action: 'close_error', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), error: error.message });
      }
    }

    openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);
    freshSignals = await getFreshSignals(entities);
    if (!forceClose) {
      for (const signal of rankSignals(freshSignals)) {
        // Se consume al evaluarla: una señal nunca se ejecuta dos veces
        await markSignal(entities, signal, 'consumed', 'consumed: evaluada por tradingLoop');
        const bot = liveBots.find(item => item.id === signal.bot_id || item.name === signal.bot_name);
        if (!bot) { await rejectSignal(entities, signal, 'bot no activo o live_enabled false'); signalStats.signalsRejected += 1; signalStats.reasons.push({ signalId: signal.id, bot: signal.bot_name, reason: 'bot no activo o live_enabled false' }); continue; }
        try {
          const pair = normalizePair(signal.pair);
          if (!SUPPORTED_PAIRS.includes(pair)) throw new Error('par no soportado por universo LIVE bajo capital');
          const [ticker, rules, takerFeePct] = await Promise.all([getTicker(pair), getAssetPairRules(pair), getTakerFeePct(pair)]);
          const profile = capitalProfile(getCapitalEUR(balances) + quoteExposure(openTrades, 'EUR'));
          const dayTrader = parseDayTrader(signal);
          const gate = await riskGate({ entities, riskConfig, bot, session: liveSession, pair, balances, openTrades, ticker, rules, signal, profile, takerFeePct, dayTrader });
          if (!gate.ok) throw new Error(gate.reason);

          signalStats.signalsAccepted += 1;
          const orderResponse = await placeMarketOrder(pair, 'buy', gate.volume);
          const exchangeOrderId = Array.isArray(orderResponse.txid) ? orderResponse.txid[0] : '';
          if (!exchangeOrderId) throw new Error('Kraken no devolvió txid de apertura');
          const execution = await getOrderExecution(exchangeOrderId);
          const tradeRisk = adjustedRisk(bot.strategy || signal.strategy || 'default', ticker.spreadPct, gate.profile, takerFeePct);
          // DayTrader: stop y objetivo fijados ANTES de entrar por el Planificador de salida
          const rawStopPrice = gate.plan ? gate.plan.stop : execution.executed_price * (1 - tradeRisk.stopLossPct / 100);
          const takeProfitPrice = gate.plan ? gate.plan.target : execution.executed_price * (1 + tradeRisk.takeProfitPct / 100);
          const trade = await entities.Trade.create({ exchange: 'kraken', mode: 'live', bot_name: bot.name, pair: displayPair(pair), side: 'buy', entry_price: execution.executed_price, executed_price: execution.executed_price, executed_volume: execution.executed_volume, amount: execution.executed_volume, fee: execution.fee, fees: execution.fee, cost: execution.cost, txid: exchangeOrderId, status: 'open', stop_loss: Number(roundTick(rawStopPrice, rules.pair_decimals)), take_profit: Number(roundTick(takeProfitPrice, rules.pair_decimals)), entry_date: nowIso, exchange_order_id: exchangeOrderId, signal_reason: signal.reason, confidence: signal.confidence, raw_response: JSON.stringify({ orderResponse, orderExecution: execution.raw_order, signal, risk: { profile: gate.profile, orderQuote: gate.orderQuote, minQuote: gate.minQuote, capitalEUR: gate.capitalEUR, avgQuoteVolume5m: gate.liquidity?.avgQuoteVolume, takeProfitPct: tradeRisk.takeProfitPct, stopLossPct: tradeRisk.stopLossPct, takerFeePct, estimatedRoundTripFeesPct: tradeRisk.estimatedRoundTripFeesPct, rewardRisk: gate.rewardRisk, lossPerTrade: gate.lossPerTrade } }), opened_by_tick_id: id, last_error: '', notes: `LIVE spot market buy SentinelAI Pro · perfil ${gate.profile.name} · usado ${execution.cost.toFixed(4)} EUR · comisiones ${takerFeePct}%/lado · TP ${tradeRisk.takeProfitPct.toFixed(2)}% · SL ${tradeRisk.stopLossPct.toFixed(2)}%` });
          const stop = await ensureExchangeStop({ entities, trade, rules, stopPrice: rawStopPrice });
          if (!stop.ok) {
            // Sin stop-loss en el exchange tras 2 intentos: se cierra la posición a mercado
            const forced = await marketCloseAndRecord({ entities, trade, pair, reason: `stop-loss rechazado por Kraken (2 intentos): ${stop.reason}`, tickId: id });
            await markSignal(entities, signal, 'executed', `executed: trade ${trade.id} cerrado a mercado sin stop`);
            await safeBotUpdate(entities, bot.id, { last_run_at: nowIso, last_order_at: nowIso, last_signal: 'sin stop-loss: cerrado a mercado', last_error: stop.reason });
            balances = await getBalances();
            signalStats.tradesClosed += 1;
            results.push({ action: 'closed_no_stop', tradeId: trade.id, bot: bot.name, selectedPair: displayPair(pair), stopError: stop.reason, ...forced });
            continue;
          }
          await markSignal(entities, signal, 'executed', `executed: trade ${trade.id}`);
          await safeBotUpdate(entities, bot.id, { trades_count: Number(bot.trades_count || 0) + 1, last_run_at: nowIso, last_order_at: nowIso, last_signal: `opened from signal: ${signal.reason}`, last_error: '' });
          await createAlert(entities, 'Orden LIVE abierta por tradingLoop', `${bot.name} abrió ${displayPair(pair)} por ~${gate.orderQuote.toFixed(4)} EUR · stop ${stop.stopPrice} (${stop.txid})`, 'success');
          openTrades.push({ ...trade, exchange_stop_txid: stop.txid, stop_loss: stop.stopPrice });
          balances = await getBalances();
          signalStats.tradesOpened += 1;
          results.push({ action: 'opened', source: 'tradingLoop', signalId: signal.id, tradeId: trade.id, bot: bot.name, selectedPair: displayPair(pair), score: signal.score, confidence: signal.confidence, entryPrice: execution.executed_price, executedVolume: execution.executed_volume, fee: execution.fee, cost: execution.cost, quoteUsed: gate.orderQuote, minRequiredQuote: gate.minQuote, capitalEUR: gate.capitalEUR, rewardRisk: gate.rewardRisk, lossPerTrade: gate.lossPerTrade, stopTxid: stop.txid, stopPrice: stop.stopPrice, exchangeOrderId, reason: signal.reason, rawResponse: orderResponse });
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
    const loopTick = new Date().toISOString();
    const summary = { loopTick, scannerTick: scanner.scannerTick, executionTick: nowIso, scannedPairs: SUPPORTED_PAIRS, openTrades: openTrades.length, signalsCreated: scanner.signalsCreated || 0, signalsAccepted: signalStats.signalsAccepted, signalsRejected: signalStats.signalsRejected + (scanner.signalsRejected || 0), tradesOpened: signalStats.tradesOpened, tradesClosed: signalStats.tradesClosed, reasons: [...(scanner.reasons || []), ...signalStats.reasons].slice(0, 10) };
    await entities.BotSession.update(liveSession.id, { last_tick_at: loopTick, last_cycle_status: 'ok', last_cycle_error: '', last_scanner_at: scanner.scannerTick, last_execution_at: nowIso, total_trades: closedTrades.length + openTrades.length, total_pnl: Number(totalPnl.toFixed(8)), last_cycle_summary: JSON.stringify(summary), last_error: (signalStats.tradesOpened || signalStats.tradesClosed) ? '' : (summary.reasons[0]?.reason || '') });
    return Response.json({ ok: true, tickId: id, ...summary, autoMode, runOnce, forceClose, env: { maxQuote: env.maxQuote, maxOpenTrades: env.maxOpenTrades, minReservedQuote: env.minReservedQuote, intervalMinutes: env.intervalMinutes }, scanner, results });
  } catch (error) {
    try {
      const base44 = createClientFromRequest(req);
      const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true }, '-created_date', 1);
      if (sessions[0]?.id) await base44.asServiceRole.entities.BotSession.update(sessions[0].id, { last_error: error.message, last_cycle_status: 'failed', last_cycle_error: `${new Date().toISOString()} · ${error.message}` });
      await base44.asServiceRole.entities.Alert.create({ title: 'tradingLoop LIVE bloqueado', message: error.message, severity: 'critical', source: 'tradingLoop LIVE', is_read: false });
    } catch {}
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});