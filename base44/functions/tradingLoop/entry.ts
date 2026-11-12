import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ═══════════════════════════════════════════════════════════════════════════════════════
// BotCo · tradingLoop — único motor de trading (Kraken spot, cuenta en EUR, solo largos)
//
// Cada 5 minutos (automatización) o a demanda:
//   1. Gestiona las posiciones abiertas (stop en Kraken, objetivo, tiempo máximo)
//   2. Comprueba protecciones y límites del día
//   3. Pasa cada par por la cadena de agentes DayTrader (adaptada de
//      github.com/Jakeschincariol/day-trader-skill, MIT):
//      Monitor → Entrada (ORB) → Salida → Máquina del Tiempo → Presupuesto
//   4. Ejecuta en modo SIMULADO (cartera virtual) o REAL (Kraken), según la sesión
//
// Nada aquí promete ganancias: cada agente puede decir que no y casi siempre lo dirá.
// ═══════════════════════════════════════════════════════════════════════════════════════

const KRAKEN_API = 'https://api.kraken.com';
const PAIRS = ['ETHEUR', 'XBTEUR', 'SOLEUR', 'XRPEUR', 'ADAEUR', 'DOTEUR', 'LINKEUR', 'ATOMEUR'];
const DISPLAY = { XBTEUR: 'BTC/EUR', ETHEUR: 'ETH/EUR', SOLEUR: 'SOL/EUR', XRPEUR: 'XRP/EUR', ADAEUR: 'ADA/EUR', DOTEUR: 'DOT/EUR', LINKEUR: 'LINK/EUR', ATOMEUR: 'ATOM/EUR' };
const ASSET_KEYS = { XBT: ['XXBT', 'XBT'], ETH: ['XETH', 'ETH'], SOL: ['SOL'], XRP: ['XXRP', 'XRP'], ADA: ['ADA'], DOT: ['DOT'], LINK: ['LINK'], ATOM: ['ATOM'] };
const BOT_NAME = 'DayTrader';
const CYCLE_MINUTES = 5;
const FALLBACK_TAKER_FEE_PCT = 0.40;   // nivel inicial de Kraken Pro si TradeVolume no responde
const PAPER_SLIPPAGE_PCT = 0.05;

// Valores por defecto: se usan para cualquier campo que no exista en RiskConfig
export const DEFAULTS = {
  // Modo y capital
  mode: 'paper',                       // 'paper' (simulado) | 'live' (Kraken real)
  paper_capital_eur: 50,
  kill_switch: false,
  // Límites de riesgo
  max_open_trades: 1,
  max_loss_per_trade_eur: 0.5,         // 1 % de 50 €
  max_daily_loss_eur: 1.5,
  max_trades_per_day: 3,
  max_order_eur: 45,
  min_reward_risk: 1.5,
  max_hold_minutes: 240,
  max_position_pct: 90,
  cash_buffer_pct: 5,
  // Protecciones (inspiradas en Freqtrade)
  cooldown_after_stop_minutes: 60,     // CooldownPeriod: pausa tras un stop-loss
  stoploss_guard_limit: 2,             // StoplossGuard: n stops en 24 h → sin entradas
  max_drawdown_pct: 10,                // MaxDrawdown: caída de la sesión → sin entradas
  // Agentes
  session_anchor_utc_hour: 7,          // inicio del rango de apertura (07:00 UTC = 08:00 España)
  or_minutes: 15,
  entry_window_utc_start: '07:15',
  entry_window_utc_end: '19:00',
  stop_rule: 'or-low',
  target_r: 3,
  min_volume_x: 1.0,
  max_fee_r: 0.5,
  moving_block_pct: 8,
  tm_runs: 10000,
  tm_seed: 19,
  tm_min_edge_points: 5
};

// ── Utilidades ──────────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const num = value => Number(value || 0);
const dp = pair => DISPLAY[normalizePair(pair)] || normalizePair(pair);
function normalizePair(pair) { const v = String(pair || '').replace('/', '').toUpperCase(); return v === 'BTCEUR' ? 'XBTEUR' : v; }
function baseAsset(pair) { return normalizePair(pair).replace(/EUR$/, ''); }
function roundDown(value, decimals) { const f = 10 ** decimals; return Math.floor(value * f) / f; }
function roundTick(value, decimals) { const f = 10 ** Number(decimals ?? 2); return Math.round(Number(value) * f) / f; }
function average(values) { return values.reduce((s, v) => s + v, 0) / Math.max(values.length, 1); }
function hmToMinutes(value) { const [h, m] = String(value || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function utcMinutes(ms) { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function startOfUtcDay(ms = Date.now()) { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function sessionAnchorMs(nowMs, hour) { const d = new Date(nowMs); const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0); return a > nowMs ? a - 86400000 : a; }
function inEntryWindow(ms, cfg) { const m = utcMinutes(ms); return m >= hmToMinutes(cfg.entry_window_utc_start) && m <= hmToMinutes(cfg.entry_window_utc_end); }
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const tradeTime = trade => new Date(trade.entry_date || trade.created_date).getTime();

// ── Cliente de Kraken ───────────────────────────────────────────────────────────────────
let lastNonce = 0;
function nextNonce() { lastNonce = Math.max(Date.now() * 1000, lastNonce + 1); return String(lastNonce); }
const hasKeys = () => !!(Deno.env.get('KRAKEN_API_KEY') && Deno.env.get('KRAKEN_API_SECRET'));

async function signKraken(path, postData, secret) {
  const nonce = new URLSearchParams(postData).get('nonce') || '';
  const secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const sha256 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce + postData));
  const pathBytes = new TextEncoder().encode(path);
  const message = new Uint8Array(pathBytes.length + sha256.byteLength);
  message.set(pathBytes, 0);
  message.set(new Uint8Array(sha256), pathBytes.length);
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, message))));
}

async function krakenPrivate(endpoint, params = {}) {
  const apiKey = Deno.env.get('KRAKEN_API_KEY');
  const apiSecret = Deno.env.get('KRAKEN_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Faltan KRAKEN_API_KEY o KRAKEN_API_SECRET en los secretos');
  const path = `/0/private/${endpoint}`;
  const postData = new URLSearchParams({ nonce: nextNonce(), ...params }).toString();
  const response = await fetch(`${KRAKEN_API}${path}`, { method: 'POST', headers: { 'API-Key': apiKey, 'API-Sign': await signKraken(path, postData, apiSecret), 'Content-Type': 'application/x-www-form-urlencoded' }, body: postData });
  const json = await response.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return json.result;
}

const publicCache = new Map();
async function krakenPublic(endpoint, params = {}) {
  const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
  const ttl = endpoint === 'AssetPairs' ? 30 * 60000 : 5000;
  const cached = publicCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ttl) return cached.result;
  const url = new URL(`${KRAKEN_API}/0/public/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const json = await (await fetch(url)).json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  publicCache.set(cacheKey, { at: Date.now(), result: json.result });
  return json.result;
}

// ── Datos de mercado ────────────────────────────────────────────────────────────────────
async function getTicker(pair) {
  const result = await krakenPublic('Ticker', { pair: normalizePair(pair) });
  const t = result[Object.keys(result)[0]];
  const ask = num(t.a?.[0]); const bid = num(t.b?.[0]); const price = num(t.c?.[0]); const open24 = num(t.o);
  if (!ask || !bid || !price || ask < bid) throw new Error(`precio inválido para ${dp(pair)}`);
  return { price, bid, ask, spreadPct: ((ask - bid) / price) * 100, open24, changePct: open24 ? ((price - open24) / open24) * 100 : 0 };
}

async function getPairRules(pair) {
  const result = await krakenPublic('AssetPairs', { pair: normalizePair(pair) });
  const raw = result[Object.keys(result)[0]] || {};
  return { status: String(raw.status || 'online'), ordermin: num(raw.ordermin), costmin: num(raw.costmin), lot_decimals: Number(raw.lot_decimals ?? 8), pair_decimals: Number(raw.pair_decimals ?? 2) };
}

// Solo velas CERRADAS: Kraken devuelve la vela en formación como última fila
async function getCandles(pair, interval = 5, limit = 288) {
  const result = await krakenPublic('OHLC', { pair: normalizePair(pair), interval });
  const key = Object.keys(result).find(k => k !== 'last');
  return (result[key] || []).slice(0, -1).slice(-limit).map(r => ({ time: Number(r[0]), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[6]) }));
}

const feeCache = new Map();
async function getTakerFeePct(pair) {
  const key = normalizePair(pair);
  const cached = feeCache.get(key);
  if (cached && Date.now() - cached.at < 3600000) return cached.fee;
  if (!hasKeys()) return FALLBACK_TAKER_FEE_PCT;
  try {
    const result = await krakenPrivate('TradeVolume', { pair: key });
    const entry = result?.fees?.[key] || Object.values(result?.fees || {})[0] || {};
    const fee = Number(entry.fee);
    if (!Number.isFinite(fee) || fee <= 0) throw new Error('sin fee');
    feeCache.set(key, { at: Date.now(), fee });
    return fee;
  } catch { return FALLBACK_TAKER_FEE_PCT; }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// AGENTES
// ═══════════════════════════════════════════════════════════════════════════════════════

// Monitor de mercado: par no operativo (HALT) o movimiento anómalo del día → no entrar
export function agentMarketMonitor({ ticker, rules, cfg }) {
  if (rules.status !== 'online') return { ok: false, reason: `el par está "${rules.status}" en Kraken` };
  if (Math.abs(ticker.changePct) >= cfg.moving_block_pct) return { ok: false, reason: `se mueve ${ticker.changePct.toFixed(2)} % hoy: posible noticia, no se entra` };
  if (ticker.spreadPct > 0.25) return { ok: false, reason: `spread ${ticker.spreadPct.toFixed(2)} % demasiado alto` };
  return { ok: true };
}

// Temporizador de entrada: primera vela de 5 min CERRADA por encima del rango de apertura
export function agentEntry({ candles, cfg, nowMs }) {
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
  if (idx < 0) return { status: 'waiting', rangeHigh, rangeLow, reason: `esperando ruptura de ${rangeHigh} (último cierre ${after.at(-1)?.close ?? '—'})` };
  const bar = after[idx];
  const triggerMs = bar.time * 1000 + 5 * 60000;
  if (idx < after.length - 1) return { status: 'stale', rangeHigh, rangeLow, reason: `la ruptura fue a las ${new Date(triggerMs).toISOString().slice(11, 16)} UTC; ya es tarde para entrar` };
  if (!inEntryWindow(triggerMs, cfg)) return { status: 'expired', rangeHigh, rangeLow, reason: 'ruptura fuera de la ventana de entrada' };
  return { status: 'triggered', entry: bar.close, rangeHigh, rangeLow, triggerTime: new Date(triggerMs).toISOString(), reason: `cierre ${bar.close} por encima del rango ${rangeHigh}` };
}

// Planificador de salida: stop y objetivo ANTES de entrar; rechaza si las comisiones pesan demasiado
export function agentExit({ entry, rangeHigh, rangeLow, decimals, feePct, spreadPct, cfg }) {
  const f = 10 ** Number(decimals ?? 2);
  const stop = Math.floor((cfg.stop_rule === 'or-mid' ? (rangeHigh + rangeLow) / 2 : rangeLow) * f) / f;
  if (stop >= entry) return { ok: false, reason: 'el stop quedaría en la entrada o por encima' };
  const risk = entry - stop;
  const target = Math.round((entry + cfg.target_r * risk) * f) / f;
  const costPerUnit = entry * (2 * feePct + spreadPct) / 100;
  const feeR = costPerUnit / risk;
  if (feeR > cfg.max_fee_r) return { ok: false, reason: `las comisiones costarían ${feeR.toFixed(2)} R (máx ${cfg.max_fee_r}): rango demasiado estrecho` };
  return { ok: true, entry, stop, target, risk, riskPct: Number((risk / entry * 100).toFixed(3)), targetR: cfg.target_r, feeR: Number(feeR.toFixed(3)) };
}

// Máquina del Tiempo: 10.000 simulaciones con velas reales de la misma hora del día (30 días)
export function agentTimeMachine({ plan, candles, intervalMin, nowMs, maxHoldMin, cfg }) {
  const slots = Math.round(1440 / intervalMin);
  const anchorToday = sessionAnchorMs(nowMs, cfg.session_anchor_utc_hour);
  const slotOf = ms => Math.floor((((ms - anchorToday) % 86400000) + 86400000) % 86400000 / (intervalMin * 60000));
  const bySession = new Map();
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]; const prev = candles[i - 1];
    if (c.time - prev.time !== intervalMin * 60) continue;
    const ms = c.time * 1000;
    if (ms >= anchorToday) continue;
    const session = Math.floor((ms - anchorToday) / 86400000);
    if (!bySession.has(session)) bySession.set(session, []);
    bySession.get(session).push({ slot: slotOf(ms), r: [c.open / prev.close, c.high / prev.close, c.low / prev.close, c.close / prev.close] });
  }
  const full = [...bySession.values()].filter(rows => rows.length === slots);
  if (full.length < 20) return { ok: false, reason: `solo ${full.length} días completos de datos (mínimo 20)` };
  const pool = Array.from({ length: slots }, () => []);
  for (const rows of full) for (const row of rows) pool[row.slot].push(row.r);
  const steps = Math.max(1, Math.floor(maxHoldMin / intervalMin));
  const startSlot = slotOf(nowMs);
  const rand = mulberry32(cfg.tm_seed);
  const { entry, stop, target, risk, feeR, targetR } = plan;
  let tFirst = 0, sFirst = 0, neither = 0, sumR = 0;
  for (let run = 0; run < cfg.tm_runs; run++) {
    let p = entry; let outcome = 0;
    for (let k = 0; k < steps; k++) {
      const near = pool[((startSlot + k) % slots + Math.floor(rand() * 5) - 2 + slots) % slots];
      const r = near[Math.floor(rand() * near.length)];
      if (p * r[2] <= stop) { outcome = -1; break; }       // si toca ambos, cuenta como stop
      if (p * r[1] >= target) { outcome = 1; break; }
      p *= r[3];
    }
    if (outcome === 1) { tFirst++; sumR += targetR - feeR; }
    else if (outcome === -1) { sFirst++; sumR += -1 - feeR; }
    else { neither++; sumR += (p - entry) / risk - feeR; }
  }
  const runs = cfg.tm_runs; const hits = tFirst + sFirst;
  const pTarget = hits ? tFirst / hits : 0;
  const breakeven = (1 + feeR) / (1 + targetR);
  const edge = (pTarget - breakeven) * 100;
  const avgNetR = sumR / runs;
  const verdict = Math.abs(edge) < 5 ? 'Cerca del equilibrio' : edge >= 15 ? 'Fuertemente a favor' : edge >= 5 ? 'A favor' : edge <= -15 ? 'Fuertemente en contra' : 'En contra';
  const ok = edge >= cfg.tm_min_edge_points && avgNetR > 0;
  return {
    ok, verdict, seed: cfg.tm_seed, runs, days: full.length,
    targetFirstPct: Number((tFirst / runs * 100).toFixed(1)), stopFirstPct: Number((sFirst / runs * 100).toFixed(1)), neitherPct: Number((neither / runs * 100).toFixed(1)),
    edgePoints: Number(edge.toFixed(1)), avgNetR: Number(avgNetR.toFixed(3)),
    reason: `${verdict}: objetivo antes que stop en ${(pTarget * 100).toFixed(1)} % (necesita ${(breakeven * 100).toFixed(1)} %), R medio neto ${avgNetR.toFixed(3)}${ok ? '' : ' → no compensa'}`
  };
}

// Gestor de presupuesto: tamaño = el menor de 4 límites, comisiones incluidas
export function agentBudget({ plan, ask, feePct, cashEUR, rules, cfg }) {
  const entry = Math.max(plan.entry, ask);
  const riskPerUnit = entry - plan.stop;
  if (riskPerUnit <= 0) return { ok: false, reason: 'el precio ya está en el stop' };
  const feePerUnit = entry * 2 * feePct / 100;
  const limits = {
    'pérdida máxima': cfg.max_loss_per_trade_eur / (riskPerUnit + feePerUnit),
    'tope de posición': cashEUR * cfg.max_position_pct / 100 / entry,
    'orden máxima': cfg.max_order_eur / entry,
    'efectivo': cashEUR * (1 - cfg.cash_buffer_pct / 100) / (entry * (1 + feePct / 100))
  };
  const [decidedBy] = Object.entries(limits).sort((a, b) => a[1] - b[1])[0];
  const qty = roundDown(Math.max(0, Math.min(...Object.values(limits))), rules.lot_decimals);
  if (!qty || qty < rules.ordermin || qty * entry < rules.costmin) return { ok: false, reason: `la cantidad (${qty}) no llega al mínimo de Kraken; limita: ${decidedBy}` };
  const netRR = ((plan.target - entry) - feePerUnit) / (riskPerUnit + feePerUnit);
  if (netRR < cfg.min_reward_risk) return { ok: false, reason: `beneficio/riesgo neto ${netRR.toFixed(2)} < ${cfg.min_reward_risk}` };
  return { ok: true, qty, entry, orderEUR: Number((qty * entry).toFixed(4)), maxLossEUR: Number((qty * (riskPerUnit + feePerUnit)).toFixed(4)), netRR: Number(netRR.toFixed(2)), decidedBy };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// CARTERA, PROTECCIONES Y LÍMITES
// ═══════════════════════════════════════════════════════════════════════════════════════

async function getConfig(entities) {
  try {
    const rows = await entities.RiskConfig.list('-created_date', 1);
    const record = (Array.isArray(rows) ? rows : rows?.items || [])[0] || {};
    const cfg = { ...DEFAULTS };
    for (const [k, v] of Object.entries(record)) if (v !== null && v !== undefined && v !== '' && k in DEFAULTS) cfg[k] = typeof DEFAULTS[k] === 'number' ? Number(v) : v;
    return cfg;
  } catch { return { ...DEFAULTS }; }
}

const tradeMode = session => (session.mode === 'live' ? 'live' : 'demo');

async function sessionTrades(entities, session) {
  const rows = await entities.Trade.filter({ mode: tradeMode(session) }, '-created_date', 200);
  const since = new Date(session.started_at || session.created_date).getTime();
  return rows.filter(t => t.session_id === session.id || (!t.session_id && tradeTime(t) >= since));
}

// Efectivo disponible en EUR. Simulado: capital virtual + resultados − lo invertido
async function getCashEUR(session, trades) {
  if (session.mode !== 'live') {
    const closedPnl = trades.filter(t => t.status === 'closed').reduce((s, t) => s + num(t.profit_loss), 0);
    const invested = trades.filter(t => t.status === 'open').reduce((s, t) => s + num(t.cost) + num(t.fee), 0);
    return num(session.assigned_capital) + closedPnl - invested;
  }
  const balances = await krakenPrivate('Balance');
  return num(balances.ZEUR) + num(balances.EUR);
}

function protections(trades, session, cfg, nowMs) {
  const closed = trades.filter(t => t.status === 'closed');
  const stops = closed.filter(t => t.exit_reason === 'stop' && nowMs - new Date(t.exit_date).getTime() < 86400000);
  const lastStop = stops.map(t => new Date(t.exit_date).getTime()).sort((a, b) => b - a)[0];
  if (lastStop && nowMs - lastStop < cfg.cooldown_after_stop_minutes * 60000) return { ok: false, reason: `pausa tras stop-loss hasta las ${new Date(lastStop + cfg.cooldown_after_stop_minutes * 60000).toISOString().slice(11, 16)} UTC` };
  if (stops.length >= cfg.stoploss_guard_limit) return { ok: false, reason: `${stops.length} stop-loss en 24 h: sin entradas hasta que pase la racha` };
  const sessionPnl = closed.reduce((s, t) => s + num(t.profit_loss), 0);
  const startCapital = num(session.assigned_capital);
  if (startCapital > 0 && sessionPnl <= -startCapital * cfg.max_drawdown_pct / 100) return { ok: false, reason: `caída de la sesión ${(sessionPnl / startCapital * 100).toFixed(1)} % (máx ${cfg.max_drawdown_pct} %): bot en pausa` };
  const today = trades.filter(t => tradeTime(t) >= startOfUtcDay(nowMs));
  if (today.length >= cfg.max_trades_per_day) return { ok: false, reason: `ya hay ${today.length} operaciones hoy (máx ${cfg.max_trades_per_day})` };
  return { ok: true, today };
}

// Pérdida del día: lo perdido en los cerrados + lo que pueden perder los abiertos en su stop
function dailyLossUsed(todayTrades) {
  return todayTrades.reduce((s, t) => {
    if (t.status === 'closed') return s + Math.max(0, -num(t.profit_loss));
    if (t.status === 'open') return s + Math.max(0, (num(t.entry_price) - num(t.stop_loss)) * num(t.amount)) + num(t.fee) * 2;
    return s;
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// EJECUCIÓN: REAL (Kraken) Y SIMULADA
// ═══════════════════════════════════════════════════════════════════════════════════════

async function queryOrder(txid) { const r = await krakenPrivate('QueryOrders', { txid, trades: 'true' }); return r?.[txid] || Object.values(r || {})[0] || null; }

async function waitExecution(txid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await sleep(1200);
    const o = await queryOrder(txid);
    const vol = num(o?.vol_exec); const cost = num(o?.cost);
    if (o && vol > 0) return { txid, volume: vol, price: num(o.price) || cost / vol, cost, fee: num(o.fee) };
  }
  throw new Error(`Kraken no confirmó la orden ${txid}`);
}

async function liveBuy(pair, qty) {
  const r = await krakenPrivate('AddOrder', { pair, type: 'buy', ordertype: 'market', volume: String(qty) });
  const txid = r?.txid?.[0];
  if (!txid) throw new Error('Kraken no devolvió el id de la compra');
  return waitExecution(txid);
}

async function livePlaceStop(pair, volume, stop, rules) {
  const r = await krakenPrivate('AddOrder', { pair, type: 'sell', ordertype: 'stop-loss', volume: String(roundDown(volume, rules.lot_decimals)), price: roundTick(stop, rules.pair_decimals).toFixed(rules.pair_decimals) });
  const txid = r?.txid?.[0];
  if (!txid) throw new Error('Kraken no devolvió el id del stop');
  return txid;
}

// Venta a mercado segura: cancela el stop (que tiene reservado el saldo), vende y,
// si la venta falla, vuelve a poner el stop. Nunca vende más de lo que tiene el trade.
async function liveSellAll(trade, rules) {
  const pair = normalizePair(trade.pair);
  let cancelled = false;
  if (trade.exchange_stop_txid) {
    try { await krakenPrivate('CancelOrder', { txid: trade.exchange_stop_txid }); cancelled = true; await sleep(800); }
    catch (e) { if (!/Unknown order|Invalid order/i.test(e.message)) throw new Error(`no se pudo cancelar el stop: ${e.message}`); }
  }
  try {
    const balances = await krakenPrivate('Balance');
    const held = (ASSET_KEYS[baseAsset(pair)] || [baseAsset(pair)]).reduce((s, k) => s + num(balances[k]), 0);
    const volume = roundDown(Math.min(num(trade.amount), held), rules.lot_decimals);
    if (!volume || volume < rules.ordermin) throw new Error(`cantidad ${volume} por debajo del mínimo de Kraken`);
    const r = await krakenPrivate('AddOrder', { pair, type: 'sell', ordertype: 'market', volume: String(volume) });
    const txid = r?.txid?.[0];
    if (!txid) throw new Error('Kraken no devolvió el id de la venta');
    return await waitExecution(txid);
  } catch (error) {
    if (cancelled) { try { trade.exchange_stop_txid = await livePlaceStop(pair, num(trade.amount), num(trade.stop_loss), rules); } catch (e) { error.message += ` · y no se pudo recolocar el stop: ${e.message}`; } }
    throw error;
  }
}

async function recordClose(entities, trade, { price, volume, cost, fee, txid }, reason, exitReason) {
  const entryCost = num(trade.cost); const entryFee = num(trade.fee);
  const pnl = cost - entryCost - entryFee - fee;
  const pnlPct = entryCost ? pnl / entryCost * 100 : 0;
  await entities.Trade.update(trade.id, {
    status: 'closed', exit_price: price, close_executed_price: price, close_executed_volume: volume, close_cost: cost, close_fee: fee,
    close_txid: txid || '', close_order_id: txid || '', exit_date: new Date().toISOString(), exit_reason: exitReason,
    profit_loss: Number(pnl.toFixed(6)), profit_loss_percent: Number(pnlPct.toFixed(3)), last_error: '',
    exchange_stop_txid: trade.exchange_stop_txid || '', notes: `${trade.notes || ''} · cerrada: ${reason}`
  });
  await createAlert(entities, `${pnl >= 0 ? 'Ganancia' : 'Pérdida'} en ${dp(trade.pair)}`, `${reason} · ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} € (${pnlPct.toFixed(2)} %)`, pnl >= 0 ? 'success' : 'warning');
  return { pnl, pnlPct };
}

async function createAlert(entities, title, message, severity = 'info') {
  try { await entities.Alert.create({ title, message, severity, source: 'tradingLoop', is_read: false }); } catch { /* sin alerta no se detiene nada */ }
}

// ── Gestión de posiciones abiertas ──────────────────────────────────────────────────────
function exitDecision(trade, ticker, cfg, nowMs) {
  if (ticker.bid <= num(trade.stop_loss)) return { reason: `stop ${trade.stop_loss} alcanzado`, exitReason: 'stop' };
  if (num(trade.take_profit) > 0 && ticker.bid >= num(trade.take_profit)) return { reason: `objetivo ${trade.take_profit} alcanzado`, exitReason: 'target' };
  if (nowMs - tradeTime(trade) >= cfg.max_hold_minutes * 60000) return { reason: `tiempo máximo de ${cfg.max_hold_minutes} min`, exitReason: 'time' };
  return null;
}

// Simulado, igual que en real:
// - el stop está puesto en Kraken y salta en cualquier momento → se busca en las velas
// - el objetivo lo vigila el bot cada 5 min → solo cuenta si el precio está ahí al mirar
//   (antes bastaba con que una vela lo tocara, y el simulado salía más optimista que el real)
function paperExitFromCandles(trade, candles) {
  const entryMs = tradeTime(trade);
  const stop = num(trade.stop_loss);
  for (const c of candles.filter(c => c.time * 1000 >= entryMs)) {
    if (c.low <= stop) return { price: Math.min(stop, c.open) * (1 - PAPER_SLIPPAGE_PCT / 100), reason: `stop ${stop} alcanzado`, exitReason: 'stop' };
  }
  return null;
}

async function manageOpenTrades({ entities, session, trades, cfg, forceCloseIds, report }) {
  const nowMs = Date.now();
  for (const trade of trades.filter(t => t.status === 'open')) {
    const pair = normalizePair(trade.pair);
    const line = { pair: dp(pair) };
    try {
      const [ticker, rules] = await Promise.all([getTicker(pair), getPairRules(pair)]);
      const pnlPct = (ticker.bid - num(trade.entry_price)) / num(trade.entry_price) * 100;
      line.pnlPercent = Number(pnlPct.toFixed(3));
      const forced = forceCloseIds === 'all' || (Array.isArray(forceCloseIds) && forceCloseIds.includes(trade.id));

      if (session.mode !== 'live') {
        const fee = await getTakerFeePct(pair);
        const hit = forced ? null : paperExitFromCandles(trade, await getCandles(pair, 5, 100));
        const decision = forced ? { reason: 'cierre manual', exitReason: 'manual' } : hit || exitDecision(trade, ticker, cfg, nowMs);
        if (!decision) { report.push({ ...line, action: 'monitoring', reason: `vigilando · stop ${trade.stop_loss} · objetivo ${trade.take_profit}` }); continue; }
        const price = hit ? hit.price : ticker.bid * (1 - PAPER_SLIPPAGE_PCT / 100);
        const cost = price * num(trade.amount);
        const result = await recordClose(entities, trade, { price, volume: num(trade.amount), cost, fee: cost * fee / 100, txid: '' }, decision.reason, decision.exitReason);
        trade.status = 'closed'; trade.profit_loss = result.pnl; trade.exit_reason = decision.exitReason; trade.exit_date = new Date().toISOString();
        report.push({ ...line, action: 'closed', reason: decision.reason, pnl: result.pnl });
        continue;
      }

      // REAL: primero el stop en Kraken. Si no está abierto, ¿se ejecutó?
      const open = (await krakenPrivate('OpenOrders', { trades: false }))?.open || {};
      if (trade.exchange_stop_txid && !open[trade.exchange_stop_txid]) {
        const order = await queryOrder(trade.exchange_stop_txid);
        if (order?.status === 'closed' && num(order.vol_exec) > 0) {
          const result = await recordClose(entities, trade, { price: num(order.price) || num(order.cost) / num(order.vol_exec), volume: num(order.vol_exec), cost: num(order.cost), fee: num(order.fee), txid: trade.exchange_stop_txid }, 'el stop-loss saltó en Kraken', 'stop');
          trade.status = 'closed'; trade.profit_loss = result.pnl; trade.exit_reason = 'stop'; trade.exit_date = new Date().toISOString();
          report.push({ ...line, action: 'closed', reason: 'stop-loss ejecutado en Kraken', pnl: result.pnl });
          continue;
        }
        trade.exchange_stop_txid = '';
      }
      if (!trade.exchange_stop_txid) {
        try {
          trade.exchange_stop_txid = await livePlaceStop(pair, num(trade.amount), num(trade.stop_loss), rules);
          await entities.Trade.update(trade.id, { exchange_stop_txid: trade.exchange_stop_txid });
          line.stop = 'recolocado';
        } catch (e) {
          // Sin stop y sin poder ponerlo: se sale a mercado
          const exec = await liveSellAll(trade, rules);
          const result = await recordClose(entities, trade, exec, `sin stop en Kraken (${e.message})`, 'safety');
          trade.status = 'closed'; trade.profit_loss = result.pnl; trade.exit_reason = 'safety';
          report.push({ ...line, action: 'closed', reason: 'no se pudo poner el stop: cerrada por seguridad', pnl: result.pnl });
          continue;
        }
      }
      const decision = forced ? { reason: 'cierre manual', exitReason: 'manual' } : exitDecision(trade, ticker, cfg, nowMs);
      if (!decision || decision.exitReason === 'stop') { report.push({ ...line, action: 'monitoring', reason: `stop activo en Kraken (${trade.stop_loss}) · objetivo ${trade.take_profit}` }); continue; }
      const exec = await liveSellAll(trade, rules);
      const result = await recordClose(entities, trade, exec, decision.reason, decision.exitReason);
      trade.status = 'closed'; trade.profit_loss = result.pnl; trade.exit_reason = decision.exitReason; trade.exit_date = new Date().toISOString();
      report.push({ ...line, action: 'closed', reason: decision.reason, pnl: result.pnl });
    } catch (error) {
      await entities.Trade.update(trade.id, { last_error: error.message, exchange_stop_txid: trade.exchange_stop_txid || '' }).catch(() => {});
      await createAlert(entities, `Error gestionando ${dp(pair)}`, error.message, 'critical');
      report.push({ ...line, action: 'error', reason: error.message });
    }
  }
}

// ── Búsqueda de entradas: la cadena de agentes ──────────────────────────────────────────
async function findEntries({ entities, session, trades, cfg, report, execution }) {
  const nowMs = Date.now();
  let openTrades = trades.filter(t => t.status === 'open');
  const gate = { ok: true, reason: '' };
  if (cfg.kill_switch) Object.assign(gate, { ok: false, reason: 'kill switch activado' });
  else if (!inEntryWindow(nowMs, cfg)) Object.assign(gate, { ok: false, reason: `fuera del horario de entradas (${cfg.entry_window_utc_start}–${cfg.entry_window_utc_end} UTC)` });
  else {
    const prot = protections(trades, session, cfg, nowMs);
    if (!prot.ok) Object.assign(gate, prot);
    else if (dailyLossUsed(prot.today) >= cfg.max_daily_loss_eur) Object.assign(gate, { ok: false, reason: `límite de pérdida diaria (${cfg.max_daily_loss_eur} €) alcanzado` });
  }

  const tradedToday = new Set(trades.filter(t => tradeTime(t) >= startOfUtcDay(nowMs)).map(t => normalizePair(t.pair)));
  for (const pair of PAIRS) {
    const row = { pair: dp(pair) };
    try {
      if (openTrades.some(t => normalizePair(t.pair) === pair)) throw new Error('Fuera: ya hay una posición abierta en este par');
      if (tradedToday.has(pair)) throw new Error('Fuera: ya se operó este par hoy (una ruptura por día)');
      const [ticker, rules, candles] = await Promise.all([getTicker(pair), getPairRules(pair), getCandles(pair, 5, 288)]);
      const market = agentMarketMonitor({ ticker, rules, cfg });
      if (!market.ok) throw new Error(`Monitor: ${market.reason}`);
      const entry = agentEntry({ candles, cfg, nowMs });
      if (entry.status !== 'triggered') throw new Error(`Entrada: ${entry.reason}`);
      const feePct = await getTakerFeePct(pair);
      const plan = agentExit({ entry: entry.entry, rangeHigh: entry.rangeHigh, rangeLow: entry.rangeLow, decimals: rules.pair_decimals, feePct, spreadPct: ticker.spreadPct, cfg });
      if (!plan.ok) throw new Error(`Salida: ${plan.reason}`);
      const tm = agentTimeMachine({ plan, candles: await getCandles(pair, 60, 720), intervalMin: 60, nowMs, maxHoldMin: cfg.max_hold_minutes, cfg });
      row.timeMachine = tm.reason;
      if (!tm.ok) throw new Error(`Máquina del Tiempo: ${tm.reason}`);
      const cash = await getCashEUR(session, trades);
      // Margen de deslizamiento: una compra a mercado puede llenarse algo por encima del ask
      const budget = agentBudget({ plan, ask: ticker.ask * (1 + PAPER_SLIPPAGE_PCT / 100), feePct, cashEUR: cash, rules, cfg });
      if (!budget.ok) throw new Error(`Presupuesto: ${budget.reason}`);
      row.ok = true;

      // ── Riesgo y ejecución ──
      if (!gate.ok) { execution.push({ action: 'signal_rejected', pair: dp(pair), reason: gate.reason }); continue; }
      if (openTrades.length >= cfg.max_open_trades) { execution.push({ action: 'signal_rejected', pair: dp(pair), reason: `ya hay ${openTrades.length} posición(es) abierta(s)` }); continue; }
      const todayTrades = trades.filter(t => tradeTime(t) >= startOfUtcDay(nowMs));
      if (dailyLossUsed(todayTrades) + budget.maxLossEUR > cfg.max_daily_loss_eur) { execution.push({ action: 'signal_rejected', pair: dp(pair), reason: `superaría la pérdida máxima del día (${cfg.max_daily_loss_eur} €)` }); continue; }

      const opened = await openTrade({ entities, session, pair, rules, plan, budget, tm, feePct, ticker });
      trades.unshift(opened); openTrades = [...openTrades, opened];
      execution.push({ action: 'opened', pair: dp(pair), price: opened.entry_price, stopPrice: opened.stop_loss, reason: `${opened.amount} uds por ${num(opened.cost).toFixed(2)} €` });
    } catch (error) {
      row.ok = false; row.reason = error.message;
    } finally {
      report.push(row);
    }
  }
  return gate;
}

async function openTrade({ entities, session, pair, rules, plan, budget, tm, feePct, ticker }) {
  const mode = tradeMode(session);
  const base = { exchange: 'kraken', mode, bot_name: BOT_NAME, pair: dp(pair), side: 'buy', status: 'open', session_id: session.id, entry_date: new Date().toISOString(), stop_loss: plan.stop, take_profit: plan.target, confidence: Math.min(0.99, 0.5 + tm.edgePoints / 100), signal_reason: `Ruptura del rango de apertura · ${tm.reason}`, notes: `stop ${plan.stop} · objetivo ${plan.target} (${plan.targetR}R) · pérdida máx ${budget.maxLossEUR} € · límite: ${budget.decidedBy}` };

  if (mode !== 'live') {
    const price = ticker.ask * (1 + PAPER_SLIPPAGE_PCT / 100);
    const cost = price * budget.qty;
    const trade = await entities.Trade.create({ ...base, entry_price: price, executed_price: price, amount: budget.qty, executed_volume: budget.qty, cost, fee: cost * feePct / 100, fees: cost * feePct / 100 });
    await createAlert(entities, `Compra simulada en ${dp(pair)}`, `${budget.qty} a ${price.toFixed(rules.pair_decimals)} · stop ${plan.stop} · objetivo ${plan.target}`, 'info');
    return trade;
  }

  const exec = await liveBuy(pair, budget.qty);
  const trade = await entities.Trade.create({ ...base, entry_price: exec.price, executed_price: exec.price, amount: exec.volume, executed_volume: exec.volume, cost: exec.cost, fee: exec.fee, fees: exec.fee, txid: exec.txid, exchange_order_id: exec.txid });
  try {
    trade.exchange_stop_txid = await livePlaceStop(pair, exec.volume, plan.stop, rules);
    await entities.Trade.update(trade.id, { exchange_stop_txid: trade.exchange_stop_txid });
    await createAlert(entities, `Compra real en ${dp(pair)}`, `${exec.volume} a ${exec.price} · stop en Kraken ${plan.stop} · objetivo ${plan.target}`, 'success');
  } catch (error) {
    // Sin stop no hay posición: se cierra en el acto
    const out = await liveSellAll(trade, rules);
    await recordClose(entities, trade, out, `Kraken rechazó el stop (${error.message})`, 'safety');
    trade.status = 'closed';
  }
  return trade;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// PUNTO DE ENTRADA
// payload: { autoMode } (automatización) · { runOnce } (manual) · { closeTradeId } · { closeAll }
// ═══════════════════════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  let entities = null; let session = null;
  try {
    const base44 = createClientFromRequest(req);
    entities = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    // Llamada manual (desde la app): solo el administrador. La automática (autoMode) no
    // necesita sesión, así que SOLO puede ejecutar el ciclo normal: nunca cierres manuales.
    const manual = !payload.autoMode;
    if (manual) {
      const user = await base44.auth.me().catch(() => null);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Solo el administrador controla el bot' }, { status: 403 });
    }

    const sessions = await entities.BotSession.filter({ active: true }, '-created_date', 5);
    session = sessions[0];
    const forceCloseIds = !manual ? null : payload.closeAll ? 'all' : payload.closeTradeId ? [String(payload.closeTradeId)] : null;
    if (!session && !manual) return Response.json({ ok: true, skipped: true, reason: 'El bot está apagado' });

    // Automática: como mucho un ciclo cada 4 minutos (la automatización va cada 5), aunque alguien llame más veces
    const lastTick = session?.last_tick_at ? new Date(session.last_tick_at).getTime() : 0;
    if (!manual && lastTick && Date.now() - lastTick < (CYCLE_MINUTES - 1) * 60000) return Response.json({ ok: true, skipped: true, reason: 'Ciclo reciente' });
    if (!session && !forceCloseIds) return Response.json({ ok: true, skipped: true, reason: 'El bot está apagado' });

    // Cierre manual sin sesión activa: se usa la última sesión del modo de esa operación
    if (!session) {
      const last = (await entities.BotSession.list('-created_date', 1))[0];
      if (!last) return Response.json({ ok: false, error: 'No hay sesiones' }, { status: 400 });
      session = last;
    }

    // Bloqueo: nunca dos ciclos a la vez
    const startedAt = session.last_cycle_started_at ? new Date(session.last_cycle_started_at).getTime() : 0;
    if (session.active && session.last_cycle_status === 'running' && Date.now() - startedAt < 4 * 60000 && !forceCloseIds) {
      return Response.json({ ok: true, skipped: true, reason: 'Ya hay un ciclo en marcha' });
    }

    if (session.mode === 'live') {
      if (!hasKeys()) throw new Error('Modo real sin claves de Kraken en los secretos');
      if (String(Deno.env.get('KRAKEN_LIVE_TRADING')).toLowerCase() !== 'true' || String(Deno.env.get('BOTCO_LIVE_ENABLED')).toLowerCase() !== 'true') throw new Error('Modo real bloqueado: KRAKEN_LIVE_TRADING y BOTCO_LIVE_ENABLED deben ser "true" en los secretos');
    }

    if (session.active) await entities.BotSession.update(session.id, { last_cycle_started_at: new Date().toISOString(), last_cycle_status: 'running' });

    const cfg = await getConfig(entities);
    const trades = await sessionTrades(entities, session);
    const positions = []; const agents = []; const execution = [];

    await manageOpenTrades({ entities, session, trades, cfg, forceCloseIds, report: positions });
    let gate = { ok: true, reason: '' };
    if (session.active && !forceCloseIds) gate = await findEntries({ entities, session, trades, cfg, report: agents, execution });

    const closed = trades.filter(t => t.status === 'closed');
    const totalPnl = closed.reduce((s, t) => s + num(t.profit_loss), 0);
    const cash = await getCashEUR(session, trades).catch(() => null);
    const summary = {
      tickAt: new Date().toISOString(), mode: session.mode, engine: 'day_trader', gate,
      agents, execution: [...positions.map(p => ({ ...p, action: p.action })), ...execution],
      stopChecks: session.mode === 'live' ? positions.map(p => ({ pair: p.pair, ok: p.action !== 'error', recreated: p.stop === 'recolocado', reason: p.reason })) : [],
      cashEUR: cash, totalPnl: Number(totalPnl.toFixed(6)), openTrades: trades.filter(t => t.status === 'open').length, closedTrades: closed.length
    };
    await entities.BotSession.update(session.id, {
      last_tick_at: summary.tickAt, last_execution_at: summary.tickAt, last_cycle_status: 'ok', last_cycle_error: '', last_error: '',
      total_pnl: summary.totalPnl, total_trades: trades.length, last_cycle_summary: JSON.stringify(summary)
    });
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    if (entities && session?.id) {
      await entities.BotSession.update(session.id, { last_cycle_status: 'failed', last_cycle_error: `${new Date().toISOString()} · ${error.message}`, last_error: error.message }).catch(() => {});
      await createAlert(entities, 'El ciclo del bot ha fallado', error.message, 'critical');
    }
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});
