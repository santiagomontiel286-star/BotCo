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
  micro_scalp: { timeoutMinutes: 45, takeProfitPct: 1.60, stopLossPct: 0.70 },
  micro_scalp_test: { timeoutMinutes: 45, takeProfitPct: 1.60, stopLossPct: 0.70 },
  ema_cross: { timeoutMinutes: 120, takeProfitPct: 2.00, stopLossPct: 0.90 },
  mean_reversion: { timeoutMinutes: 90, takeProfitPct: 1.80, stopLossPct: 0.80 },
  first_live_trade: { timeoutMinutes: 60, takeProfitPct: 1.60, stopLossPct: 0.70 },
  default: { timeoutMinutes: 90, takeProfitPct: 1.80, stopLossPct: 0.80 }
};

let lastNonce = 0;
const publicCache = new Map();

function nextNonce() { const now = Date.now() * 1000; lastNonce = Math.max(now, lastNonce + 1); return String(lastNonce); }
function tickId() { return `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function toBool(value) { return String(value || '').toLowerCase() === 'true'; }
function normalizePair(pair) { const value = String(pair || '').replace('/', '').toUpperCase(); if (value === 'BTCEUR') return 'XBTEUR'; if (value === 'BTCUSD') return 'XBTUSD'; return value; }
function displayPair(pair) { return DISPLAY_PAIRS[normalizePair(pair)] || normalizePair(pair); }
function quoteCurrency(pair) { return normalizePair(pair).endsWith('EUR') ? 'EUR' : 'USD'; }
function baseAsset(pair) { const value = normalizePair(pair); if (value.startsWith('XBT')) return 'XBT'; if (value.startsWith('ETH')) return 'ETH'; if (value.startsWith('SOL')) return 'SOL'; if (value.startsWith('XRP')) return 'XRP'; if (value.startsWith('ADA')) return 'ADA'; if (value.startsWith('DOT')) return 'DOT'; if (value.startsWith('LINK')) return 'LINK'; if (value.startsWith('ATOM')) return 'ATOM'; return value.slice(0, -3); }
function getBalanceAmount(balances, currency) { return (QUOTE_KEYS[currency] || [currency]).reduce((sum, key) => sum + Number(balances[key] || 0), 0); }
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
function adjustedRisk(strategy, spreadPct = 0, profile = null) { const base = profile ? { timeoutMinutes: profile.name === 'micro' ? 30 : 90, takeProfitPct: profile.takeProfitPct, stopLossPct: profile.stopLossPct } : (STRATEGY_RISK[strategy] || STRATEGY_RISK.default); const estimatedRoundTripFeesPct = 0.26; return { ...base, estimatedRoundTripFeesPct, takeProfitPct: Math.max(base.takeProfitPct, spreadPct + estimatedRoundTripFeesPct + 0.05) }; }

function envConfig() {
  const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'KRAKEN_LIVE_TRADING', 'BOTCO_LIVE_ENABLED'];
  const missing = required.filter(name => !Deno.env.get(name));
  const maxQuote = Math.min(Number(Deno.env.get('MAX_LIVE_ORDER_QUOTE') || '8'), 8);
  const maxOpenTrades = Math.min(Number(Deno.env.get('MAX_OPEN_LIVE_TRADES') || '5'), 5);
  const minReservedQuote = Math.max(Number(Deno.env.get('MIN_RESERVED_QUOTE') || '4'), 4);
  const intervalMinutes = Math.max(5, Number(Deno.env.get('BOTCO_AUTOTRADE_INTERVAL_MINUTES') || '5'));
  const krakenLiveTrading = toBool(Deno.env.get('KRAKEN_LIVE_TRADING'));
  const botcoLiveEnabled = toBool(Deno.env.get('BOTCO_LIVE_ENABLED'));
  return { missing, maxQuote, maxOpenTrades, minReservedQuote, intervalMinutes, krakenLiveTrading, botcoLiveEnabled, ok: missing.length === 0 && krakenLiveTrading && botcoLiveEnabled && maxQuote > 0 };
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
  return { price, bid, ask, spreadPct: ((ask - bid) / price) * 100, volume24h };
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
  return (result[key] || []).slice(-240).map(row => ({ time: Number(row[0]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[6]) }));
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
async function getBalances() { return krakenPrivate('Balance'); }

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

async function closeTradeMarket(trade, currentPrice) {
  const pair = normalizePair(trade.pair);
  const asset = baseAsset(pair);
  const balances = await getBalances();
  const availableAsset = getAssetBalance(balances, asset);
  const requested = Number(trade.amount || trade.executed_volume || 0) * 0.995;
  const closeAmount = Math.min(requested, availableAsset * 0.995);
  const rules = await getAssetPairRules(pair);
  const volume = roundDown(closeAmount, rules.lot_decimals);
  if (!volume || volume <= 0 || (rules.ordermin && volume < rules.ordermin)) throw new Error(`Volumen de cierre inferior al mínimo Kraken para ${displayPair(pair)}`);
  if (rules.costmin && volume * currentPrice < rules.costmin) throw new Error(`Coste de cierre inferior al mínimo Kraken para ${displayPair(pair)}`);
  const response = await placeMarketOrder(pair, trade.side === 'buy' ? 'sell' : 'buy', volume);
  const closeOrderId = Array.isArray(response.txid) ? response.txid[0] : '';
  if (!closeOrderId) throw new Error('Kraken no devolvió txid de cierre');
  const execution = await getOrderExecution(closeOrderId);
  return { response, execution };
}

function shouldCloseTrade(trade, ticker, forceClose, bot) {
  if (forceClose) return { close: true, reason: 'Cierre manual solicitado' };
  const entry = Number(trade.entry_price || 0);
  const amount = Number(trade.amount || 0);
  if (!entry || !amount) return { close: false, reason: 'Trade sin entrada o volumen válido' };
const profile = capitalProfile(ticker.price > 0 ? 30 : 0);
const risk = adjustedRisk(bot?.strategy || trade.strategy || 'default', ticker.spreadPct);
  if (pnlPct >= risk.takeProfitPct) return { close: true, reason: `TP ${risk.takeProfitPct.toFixed(2)}% alcanzado`, pnlPct };
  if (pnlPct <= -risk.stopLossPct) return { close: true, reason: `SL -${risk.stopLossPct.toFixed(2)}% alcanzado`, pnlPct };
  if (ageMs >= risk.timeoutMinutes * 60 * 1000) return { close: true, reason: `Timeout ${risk.timeoutMinutes} minutos`, pnlPct };
  return { close: false, reason: `Monitoreando hasta ${risk.timeoutMinutes}m`, pnlPct };
}

async function createAlert(entities, title, message, severity = 'info') { try { await entities.Alert.create({ title, message, severity, source: 'tradingLoop LIVE', is_read: false }); } catch (error) { console.log(`Alert skipped: ${error.message}`); } }
async function safeBotUpdate(entities, botId, data) { if (!botId) return; try { await entities.Bot.update(botId, data); } catch (error) { console.log(`Bot update skipped: ${error.message}`); } }
async function rejectSignal(entities, signal, reason) { if (!signal?.id) return; await entities.Signal.update(signal.id, { status: 'rejected', reason: `${signal.reason || ''} · rejected: ${reason}` }); }
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
  return signals.filter(signal => signal.side === 'buy' && Number(signal.score || 0) >= 65 && Number(signal.confidence || 0) >= 0.65).sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || (Number(b.confidence || 0) - Number(a.confidence || 0)) || (new Date(b.created_date) - new Date(a.created_date)));
}

async function evaluateCandidate({ bot, pair, balances, openTrades, existingSignals, env }) {
  const normalizedPair = normalizePair(pair);
  if (openTrades.some(trade => normalizePair(trade.pair) === normalizedPair)) throw new Error('ya existe trade abierto del mismo par');
  if (existingSignals.some(signal => signal.bot_id === bot.id && normalizePair(signal.pair) === normalizedPair)) throw new Error('ya existe señal nueva del mismo bot/par');
  const [ticker, rules, candles] = await Promise.all([getTicker(normalizedPair), getAssetPairRules(normalizedPair), getCandles(normalizedPair, 5)]);
  const quote = quoteCurrency(normalizedPair);
  const balanceQuote = getBalanceAmount(balances, quote);
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
  const expiresAt = new Date(now.getTime() + Math.max(10 * 60 * 1000, env.intervalMinutes * 2 * 60 * 1000)).toISOString();
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

async function riskCheck({ entities, bot, session, pair, balances, env, openTrades, ticker, rules, signal }) {
  if (bot.status !== 'active' || bot.trading_mode !== 'live' || bot.live_enabled !== true) return { ok: false, reason: 'Bot no está LIVE activo' };
  if (!session || session.active !== true || session.mode !== 'live') return { ok: false, reason: 'No hay BotSession LIVE activa' };
  if (bot.cooldown_until && new Date(bot.cooldown_until).getTime() > Date.now()) return { ok: false, reason: `Cooldown activo hasta ${bot.cooldown_until}` };
  if (openTrades.some(trade => normalizePair(trade.pair) === normalizePair(pair))) return { ok: false, reason: 'ya existe trade abierto del mismo par' };
  if (ticker.spreadPct > 0.25) return { ok: false, reason: 'spread alto' };
  const quote = quoteCurrency(pair);
  const balanceQuote = getBalanceAmount(balances, quote);
  const exposure = quoteExposure(openTrades, quote);
  const profile = capitalProfile(balanceQuote + exposure);
  if (openTrades.length >= Math.min(env.maxOpenTrades, profile.maxOpenTrades)) return { ok: false, reason: `max open trades perfil ${profile.name} alcanzado` };
  if (!profile.pairs.includes(normalizePair(pair))) return { ok: false, reason: `perfil ${profile.name}: par no prioritario`, balanceQuote };
  if (signal && Number(signal.score || 0) < profile.minScore) return { ok: false, reason: `score ${signal.score} inferior al mínimo ${profile.minScore} del perfil ${profile.name}`, balanceQuote };
  const spendable = Math.max(0, balanceQuote - env.minReservedQuote);
  const budgetLeft = Math.max(0, (balanceQuote + exposure) * 0.8 - exposure);
  const maxBotQuote = Math.min(Number(bot.max_order_quote || bot.max_order_usd || env.maxQuote), env.maxQuote);
  const orderQuote = Math.min(maxBotQuote, spendable, budgetLeft);
  const minQuote = minRequiredQuote(rules, ticker.price);
  const volume = roundDown(orderQuote / ticker.price, rules.lot_decimals);
  if (orderQuote <= 0 || balanceQuote < env.minReservedQuote) return { ok: false, reason: 'balance insuficiente', balanceQuote, orderQuote, minQuote };
  if (orderQuote < minQuote || volume < rules.ordermin) return { ok: false, reason: 'capital insuficiente para mínimo Kraken', balanceQuote, orderQuote, minQuote };
  const candles = await getCandles(pair, 5);
  const liquidity = liquidityCheck(candles, ticker, minQuote);
  if (!liquidity.ok) return { ok: false, reason: liquidity.reason, balanceQuote, orderQuote, minQuote };
  const expected = adjustedRisk(bot.strategy || 'default', ticker.spreadPct, profile);
  if (ticker.spreadPct + expected.estimatedRoundTripFeesPct >= expected.takeProfitPct) return { ok: false, reason: 'TP no cubre fees + spread', balanceQuote, orderQuote, minQuote };
  const recent = await entities.Trade.filter({ bot_name: bot.name, mode: 'live' }, '-created_date', 20);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayLoss = recent.filter(trade => new Date(trade.exit_date || trade.updated_date || trade.created_date).getTime() >= today.getTime()).reduce((sum, trade) => sum + Math.min(0, Number(trade.profit_loss || 0)), 0);
  if (Math.abs(todayLoss) >= Number(bot.daily_loss_limit || 3)) return { ok: false, reason: 'daily loss limit alcanzado', balanceQuote, orderQuote, minQuote };
  const consecutiveLosses = recent.filter(trade => trade.status === 'closed').slice(0, 3).filter(trade => Number(trade.profit_loss || 0) < 0).length;
  if (consecutiveLosses >= 3) return { ok: false, reason: '3 pérdidas consecutivas del bot', balanceQuote, orderQuote, minQuote };
  return { ok: true, balanceQuote, orderQuote, minQuote, volume, liquidity, profile };
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

    if (validateOnly) return Response.json({ ok: env.ok, ...env, masterStrategy: MASTER_STRATEGY.version, dynamicProfiles: ['micro:65', 'pequeño:70', 'medio:75', 'alto:80', 'institucional:85'], liveSession: !!liveSession, liveBots: liveBots.length, supportedPairs: SUPPORTED_PAIRS, message: env.ok ? 'tradingLoop LIVE con SentinelAI Pro activo' : 'Entorno LIVE incompleto o bloqueado' });
    assertLiveEnv();
    if (!liveSession) return Response.json({ ok: true, skipped: true, reason: 'No hay BotSession LIVE activa', tickId: id });
    if (!runOnce && !autoMode && !forceClose) return Response.json({ error: 'Payload inválido: usa runOnce, autoMode, forceClose o validateOnly' }, { status: 400 });
    if (!liveBots.length && !forceClose) return Response.json({ ok: true, skipped: true, reason: 'No hay bots LIVE activos', tickId: id });

    const nowIso = new Date().toISOString();
    const results = [];
    let balances = await getBalances();
    let openTrades = await entities.Trade.filter({ mode: 'live', status: 'open' }, '-created_date', 50);
    const scanner = forceClose ? { scannerTick: nowIso, scannedPairs: SUPPORTED_PAIRS, scannedBots: liveBots.length, evaluations: 0, signalsCreated: 0, signalsRejected: 0, reasons: [] } : await runScanner(entities, liveSession, liveBots, balances, openTrades, env);
    let freshSignals = await getFreshSignals(entities);
    const signalStats = { signalsAccepted: 0, signalsRejected: 0, tradesOpened: 0, tradesClosed: 0, reasons: [] };

    for (const trade of openTrades) {
      const pair = normalizePair(trade.pair);
      const bot = bots.find(item => item.name === trade.bot_name);
      try {
        const ticker = await getTicker(pair);
        let decision = shouldCloseTrade(trade, ticker, forceClose, bot);
        const contrarySignal = freshSignals.find(signal => signal.side === 'sell' && signal.bot_id === bot?.id && normalizePair(signal.pair) === pair);
        if (!decision.close && contrarySignal) decision = { close: true, reason: `Señal contraria del mismo bot: ${contrarySignal.reason}`, signalId: contrarySignal.id };
        if (!decision.close) { results.push({ action: 'monitoring', tradeId: trade.id, bot: trade.bot_name, pair: displayPair(pair), price: ticker.price, pnlPercent: decision.pnlPct, reason: decision.reason }); continue; }
        const closed = await closeTradeMarket(trade, ticker.price);
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
        if (openTrades.length >= env.maxOpenTrades) break;
        const bot = liveBots.find(item => item.id === signal.bot_id || item.name === signal.bot_name);
        if (!bot) { await rejectSignal(entities, signal, 'bot no activo o live_enabled false'); signalStats.signalsRejected += 1; signalStats.reasons.push({ signalId: signal.id, bot: signal.bot_name, reason: 'bot no activo o live_enabled false' }); continue; }
        try {
          const pair = normalizePair(signal.pair);
          if (!SUPPORTED_PAIRS.includes(pair)) throw new Error('par no soportado por universo LIVE bajo capital');
          const ticker = await getTicker(pair);
          const rules = await getAssetPairRules(pair);
          const risk = await riskCheck({ entities, bot, session: liveSession, pair, balances, env, openTrades, ticker, rules, signal });
          if (!risk.ok) throw new Error(risk.reason);

          await markSignal(entities, signal, 'accepted', 'accepted: Risk Guardian OK');
          signalStats.signalsAccepted += 1;
          const orderResponse = await placeMarketOrder(pair, 'buy', risk.volume);
          const exchangeOrderId = Array.isArray(orderResponse.txid) ? orderResponse.txid[0] : '';
          if (!exchangeOrderId) throw new Error('Kraken no devolvió txid de apertura');
          const execution = await getOrderExecution(exchangeOrderId);
          const tradeRisk = adjustedRisk(bot.strategy || signal.strategy || 'default', ticker.spreadPct, risk.profile);
          const trade = await entities.Trade.create({ exchange: 'kraken', mode: 'live', bot_name: bot.name, pair: displayPair(pair), side: 'buy', entry_price: execution.executed_price, executed_price: execution.executed_price, executed_volume: execution.executed_volume, amount: execution.executed_volume, fee: execution.fee, fees: execution.fee, cost: execution.cost, txid: exchangeOrderId, status: 'open', stop_loss: Number((execution.executed_price * (1 - tradeRisk.stopLossPct / 100)).toFixed(rules.pair_decimals)), take_profit: Number((execution.executed_price * (1 + tradeRisk.takeProfitPct / 100)).toFixed(rules.pair_decimals)), entry_date: nowIso, exchange_order_id: exchangeOrderId, signal_reason: signal.reason, confidence: signal.confidence, raw_response: JSON.stringify({ orderResponse, orderExecution: execution.raw_order, signal, risk: { profile: risk.profile, orderQuote: risk.orderQuote, minQuote: risk.minQuote, balanceQuote: risk.balanceQuote, avgQuoteVolume5m: risk.liquidity?.avgQuoteVolume, takeProfitPct: tradeRisk.takeProfitPct, estimatedRoundTripFeesPct: tradeRisk.estimatedRoundTripFeesPct } }), opened_by_tick_id: id, last_error: '', notes: `LIVE spot market buy SentinelAI Pro · perfil ${risk.profile.name} · usado ${execution.cost.toFixed(2)} ${quoteCurrency(pair)} · max ${Math.min(env.maxOpenTrades, risk.profile.maxOpenTrades)} posiciones · TP ${tradeRisk.takeProfitPct.toFixed(2)}%` });
          await markSignal(entities, signal, 'executed', `executed: trade ${trade.id}`);
          await safeBotUpdate(entities, bot.id, { trades_count: Number(bot.trades_count || 0) + 1, last_run_at: nowIso, last_order_at: nowIso, last_signal: `opened from signal: ${signal.reason}`, last_error: '' });
          await createAlert(entities, 'Orden LIVE abierta por tradingLoop', `${bot.name} abrió ${displayPair(pair)} por ~${risk.orderQuote.toFixed(2)} ${quoteCurrency(pair)}`, 'success');
          openTrades.push(trade);
          balances = await getBalances();
          signalStats.tradesOpened += 1;
          results.push({ action: 'opened', source: 'tradingLoop', signalId: signal.id, tradeId: trade.id, bot: bot.name, selectedPair: displayPair(pair), score: signal.score, confidence: signal.confidence, entryPrice: execution.executed_price, executedVolume: execution.executed_volume, fee: execution.fee, cost: execution.cost, quoteUsed: risk.orderQuote, minRequiredQuote: risk.minQuote, availableQuote: risk.balanceQuote, maxOpenTrades: env.maxOpenTrades, openTrades: openTrades.length, exchangeOrderId, reason: signal.reason, rawResponse: orderResponse });
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
    await entities.BotSession.update(liveSession.id, { last_tick_at: loopTick, last_scanner_at: scanner.scannerTick, last_execution_at: nowIso, total_trades: closedTrades.length + openTrades.length, total_pnl: Number(totalPnl.toFixed(8)), last_cycle_summary: JSON.stringify(summary), last_error: (signalStats.tradesOpened || signalStats.tradesClosed) ? '' : (summary.reasons[0]?.reason || '') });
    return Response.json({ ok: true, tickId: id, ...summary, autoMode, runOnce, forceClose, env: { maxQuote: env.maxQuote, maxOpenTrades: env.maxOpenTrades, minReservedQuote: env.minReservedQuote, intervalMinutes: env.intervalMinutes }, scanner, results });
  } catch (error) {
    try {
      const base44 = createClientFromRequest(req);
      const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true }, '-created_date', 1);
      if (sessions[0]?.id) await base44.asServiceRole.entities.BotSession.update(sessions[0].id, { last_error: error.message, last_tick_at: new Date().toISOString() });
      await base44.asServiceRole.entities.Alert.create({ title: 'tradingLoop LIVE bloqueado', message: error.message, severity: 'critical', source: 'tradingLoop LIVE', is_read: false });
    } catch {}
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});