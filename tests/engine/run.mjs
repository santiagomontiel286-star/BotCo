import assert from 'node:assert/strict';
const env = { KRAKEN_API_KEY: 'k', KRAKEN_API_SECRET: Buffer.from('secret').toString('base64'), KRAKEN_LIVE_TRADING: 'true', BOTCO_LIVE_ENABLED: 'true' };
globalThis.Deno = { env: { get: k => env[k] }, serve: fn => { globalThis.__handler = fn; } };
globalThis.__db = {};
const M = globalThis.__market = { privateCalls: [], balance: { ZEUR: '50' }, orders: {}, open: {} };
const now = Date.now(); const B = 300;
const curBar = Math.floor(now / 1000 / B) * B;
const anchorHour = (new Date(now).getUTCHours() + 21) % 24;         // ancla hace ~3 h
const anchor = Math.floor(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), anchorHour) / 1000);
const anchorS = anchor > now / 1000 ? anchor - 86400 : anchor;
function c5(breakout) {
  const rows = [];
  for (let t = anchorS - 7200; t <= curBar; t += B) {
    let o = 100, h = 100.3, l = 99.8, c = 100.1, v = 10;
    if (t >= anchorS && t < anchorS + 900) { h = 101; l = 99; }
    if (breakout && t === curBar - B) { c = 101.5; h = 101.7; v = 30; }
    if (t === curBar) { c = breakout ? 101.6 : 100.1; }
    rows.push([t, String(o), String(h), String(l), String(c), '0', String(v), 1]);
  }
  return rows;
}
function c60() { const rows = []; let p = 80; let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 721; i >= 0; i--) { const t = Math.floor(now / 3600000) * 3600 - i * 3600; const o = p; const c = p * (1.015 + (r() - 0.5) * 0.01); rows.push([t, String(o), String(Math.max(o, c) * 1.002), String(Math.min(o, c) * 0.998), String(c), '0', '5', 1]); p = c; } return rows; }
const OHLC = { 5: { ETHEUR: c5(true) }, 60: c60() };
globalThis.fetch = async (url, init) => {
  const u = new URL(url); const ep = u.pathname.split('/').pop(); const pair = u.searchParams.get('pair');
  const ok = result => ({ json: async () => ({ error: [], result }) });
  if (u.pathname.includes('/public/')) {
    if (ep === 'Ticker') { const eth = pair === 'ETHEUR' && M.ethPrice; const p = eth || (pair === 'ETHEUR' ? 101.58 : 100.1); return ok({ [pair]: { a: [String(p + 0.03)], b: [String(p - 0.02)], c: [String(p)], o: '100' } }); }
    if (ep === 'AssetPairs') return ok({ [pair]: { status: 'online', ordermin: '0.002', costmin: '0.5', lot_decimals: 8, pair_decimals: 2 } });
    if (ep === 'OHLC') { const iv = u.searchParams.get('interval'); return ok({ [pair]: iv === '60' ? OHLC[60] : (OHLC[5][pair] || c5(false)), last: 0 }); }
  }
  const params = Object.fromEntries(new URLSearchParams(init.body)); M.privateCalls.push({ ep, ...params });
  if (ep === 'Balance') return ok(M.balance);
  if (ep === 'TradeVolume') return ok({ fees: { [params.pair]: { fee: '0.4000' } } });
  if (ep === 'OpenOrders') return ok({ open: M.open });
  if (ep === 'CancelOrder') { delete M.open[params.txid]; return ok({ count: 1 }); }
  if (ep === 'QueryOrders') return ok({ [params.txid]: M.orders[params.txid] });
  if (ep === 'AddOrder') {
    const txid = `TX${Object.keys(M.orders).length + 1}`; const vol = Number(params.volume); const px = params.type === 'buy' ? 101.61 : (M.ethPrice || 101.5);
    if (params.ordertype === 'stop-loss') { M.open[txid] = { descr: params }; M.orders[txid] = { status: 'open', vol_exec: '0' }; }
    else { M.orders[txid] = { status: 'closed', vol_exec: String(vol), cost: String(vol * px), fee: String(vol * px * 0.004), price: String(px) }; }
    return ok({ txid: [txid] });
  }
  throw new Error('sin mock ' + ep);
};
await import('./.loop.mjs');
const wait = () => new Promise(r => setTimeout(r, 5200)); // la caché pública del motor dura 5 s
// Cada ciclo automático de la prueba simula que han pasado 5 min (el motor salta ciclos demasiado seguidos)
const call = async (body = { autoMode: true }, { keepTick = false } = {}) => {
  if (body.autoMode && !keepTick) for (const s of globalThis.__db.BotSession || []) delete s.last_tick_at;
  return (await globalThis.__handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))).json();
};
const db = globalThis.__db;
const cfgBase = { entry_window_utc_start: '00:00', entry_window_utc_end: '23:59', session_anchor_utc_hour: anchorHour };

// ── 1. Bot apagado ──
db.RiskConfig = [{ id: 'rc', ...cfgBase }];
let r = await call(); assert.equal(r.skipped, true); console.log('✓ bot apagado: no hace nada');

// ── 2. SIMULADO: compra ──
db.BotSession = [{ id: 'S1', active: true, mode: 'demo', assigned_capital: 50, started_at: new Date(now - 3600e3).toISOString() }];
r = await call();
assert.equal(r.ok, true, JSON.stringify(r));
const eth = r.agents.find(a => a.pair === 'ETH/EUR');
assert.equal(eth.ok, true, JSON.stringify(eth));
assert.ok(r.agents.filter(a => a.pair !== 'ETH/EUR').every(a => a.reason.startsWith('Entrada:')), 'otros pares esperan ruptura');
let t = db.Trade[0];
assert.equal(t.mode, 'demo'); assert.equal(t.session_id, 'S1'); assert.equal(t.stop_loss, 99); assert.equal(t.take_profit, 109);
const maxLoss = (t.entry_price - t.stop_loss) * t.amount + t.cost * 0.008;
assert.ok(maxLoss <= 0.5 + 1e-6, 'pérdida máxima ' + maxLoss);
assert.equal(M.privateCalls.filter(c => c.ep === 'AddOrder').length, 0, 'simulado no toca Kraken');
console.log(`✓ simulado: compra ${t.amount} ETH a ${t.entry_price.toFixed(2)} (${t.cost.toFixed(2)} €), stop 99, objetivo 109, pérdida máx ${maxLoss.toFixed(3)} €`);

// ── 3. Lock: ciclo en marcha ──
db.BotSession[0].last_cycle_status = 'running'; db.BotSession[0].last_cycle_started_at = new Date().toISOString();
r = await call(); assert.equal(r.skipped, true); db.BotSession[0].last_cycle_status = 'ok';
console.log('✓ bloqueo: no corre dos ciclos a la vez');

// ── 4. SIMULADO: llega al objetivo ──
t.entry_date = new Date(now - 30 * 60e3).toISOString();
OHLC[5].ETHEUR = [...c5(true).slice(0, -1), [curBar, '101.6', '109.5', '101.5', '109.2', '0', '9', 1], [curBar + B, '109', '109', '109', '109', '0', '1', 1]];
M.ethPrice = 104;                      // la vela tocó 109,5 pero al mirar el precio está en 104
await wait(); r = await call();
assert.equal(db.Trade[0].status, 'open', 'como en real: un pico que no se ve al mirar no cierra en objetivo');
console.log('✓ simulado fiel al real: un pico que toca el objetivo entre dos ciclos no cuenta');
M.ethPrice = 109.2;
await wait(); r = await call();
t = db.Trade[0];
assert.equal(t.status, 'closed'); assert.equal(t.exit_reason, 'target'); assert.ok(t.profit_loss > 0);
assert.ok(r.agents.find(a => a.pair === 'ETH/EUR').reason.includes('ya se operó'), 'no repite el par el mismo día');
console.log(`✓ simulado: cierra en objetivo con +${t.profit_loss.toFixed(3)} € (comisiones incluidas) y no repite ETH hoy`);
M.ethPrice = 0;

// ── 5. Protecciones: stop reciente → pausa ──
db.Trade.push({ id: 'old', mode: 'demo', session_id: 'S1', pair: 'SOL/EUR', status: 'closed', exit_reason: 'stop', profit_loss: -0.4, entry_date: new Date(now - 90 * 60e3).toISOString(), exit_date: new Date(now - 10 * 60e3).toISOString(), cost: 10 });
OHLC[5].ETHEUR = c5(true); db.Trade[0].pair = 'ADA/EUR';
await wait(); r = await call();
assert.equal(r.gate.ok, false); assert.match(r.gate.reason, /pausa tras stop-loss/);
assert.equal(db.Trade.filter(x => x.status === 'open').length, 0);
console.log('✓ protección: tras un stop-loss no entra («' + r.gate.reason + '»)');
db.Trade = [];

// ── 6. Límites: kill switch ──
db.RiskConfig[0].kill_switch = true; r = await call(); assert.match(r.gate.reason, /kill switch/); assert.equal((db.Trade || []).length, 0);
db.RiskConfig[0].kill_switch = false; console.log('✓ kill switch: bloquea entradas');

// ── 7. REAL: compra + stop en Kraken ──
db.BotSession = [{ id: 'L1', active: true, mode: 'live', assigned_capital: 50, started_at: new Date(now - 3600e3).toISOString() }];
M.privateCalls = [];
r = await call();
assert.equal(r.ok, true, JSON.stringify(r));
t = db.Trade.find(x => x.mode === 'live');
assert.ok(t, 'trade real creado'); assert.ok(t.exchange_stop_txid, 'stop en Kraken');
const adds = M.privateCalls.filter(c => c.ep === 'AddOrder');
assert.deepEqual(adds.map(a => a.ordertype), ['market', 'stop-loss']); assert.equal(adds[1].price, '99.00');
console.log(`✓ real: compra a mercado ${t.amount} ETH y pone stop-loss ${adds[1].price} en Kraken (${t.exchange_stop_txid})`);

// ── 8. REAL: el stop salta en Kraken ──
M.balance = { ZEUR: '35' };
delete M.open[t.exchange_stop_txid];
M.orders[t.exchange_stop_txid] = { status: 'closed', vol_exec: String(t.amount), cost: String(t.amount * 98.9), fee: String(t.amount * 98.9 * 0.004), price: '98.9' };
t.entry_date = new Date(now - 20 * 60e3).toISOString();
M.privateCalls = [];
r = await call();
t = db.Trade.find(x => x.id === t.id);
assert.equal(t.status, 'closed'); assert.equal(t.exit_reason, 'stop'); assert.ok(t.profit_loss < 0 && t.profit_loss >= -0.55, 'pérdida ' + t.profit_loss);
assert.equal(M.privateCalls.filter(c => c.ep === 'AddOrder').length, 0, 'no recoloca stop ni vende de más');
console.log(`✓ real: detecta que el stop saltó, registra ${t.profit_loss.toFixed(3)} € y no vende nada más`);

// ── 9. REAL: cierre manual cancela el stop y vende ──
db.Trade = []; db.BotSession[0].last_cycle_status = 'ok'; M.balance = { ZEUR: '50' }; OHLC[5].ETHEUR = c5(true);
await wait(); r = await call(); t = db.Trade.find(x => x.status === 'open'); assert.ok(t);
M.balance = { ZEUR: '35', XETH: String(t.amount) }; M.privateCalls = [];
// Seguridad: sin sesión o sin ser administrador no se controla el bot
r = await call({ autoMode: true, closeTradeId: t.id }); r = await call({ autoMode: true, closeAll: true });
assert.equal(db.Trade.find(x => x.id === t.id).status, 'open', 'una llamada automática (sin sesión) no puede cerrar posiciones');
assert.equal(M.privateCalls.filter(c => c.ep === 'AddOrder' || c.ep === 'CancelOrder').length, 0, 'ni toca órdenes en Kraken');
globalThis.__auth.me = null; r = await call({ closeAll: true }); assert.equal(r.error, 'Unauthorized');
globalThis.__auth.me = { id: 'x', role: 'user' }; r = await call({ closeAll: true }); assert.match(r.error, /administrador/);
r = await call({ runOnce: true }); assert.match(r.error, /administrador/);
delete globalThis.__auth.me;
db.BotSession[0].last_cycle_status = 'ok'; db.BotSession[0].last_tick_at = new Date().toISOString(); M.privateCalls = [];
r = await call({ autoMode: true }, { keepTick: true }); assert.equal(r.reason, 'Ciclo reciente', 'no se puede forzar ciclos seguidos');
assert.equal(M.privateCalls.length, 0);
assert.equal(db.Trade.find(x => x.id === t.id).status, 'open');
console.log('✓ seguridad: sin sesión solo corre el ciclo normal (como mucho uno cada 4 min) y nunca cierra posiciones; solo el administrador controla el bot');
db.BotSession[0].last_cycle_status = 'ok'; M.privateCalls = [];
r = await call({ closeTradeId: t.id });
const seq = M.privateCalls.map(c => c.ep + (c.ordertype ? ':' + c.ordertype : ''));
assert.ok(seq.indexOf('CancelOrder') < seq.indexOf('AddOrder:market'), seq.join(','));
t = db.Trade.find(x => x.id === t.id); assert.equal(t.status, 'closed'); assert.equal(t.exit_reason, 'manual');
console.log('✓ real: cierre manual cancela el stop antes de vender (' + seq.join(' → ') + ')');

// ── 10. Modo real bloqueado sin secretos ──
env.BOTCO_LIVE_ENABLED = 'false'; db.BotSession[0].last_cycle_status = 'ok';
r = await call(); assert.equal(r.ok, false); assert.match(r.error, /bloqueado/); env.BOTCO_LIVE_ENABLED = 'true';
console.log('✓ real bloqueado si los secretos no lo permiten');
// Datos del bot: solo el administrador (el motor usa el rol de servicio)
import fs from 'node:fs';
for (const f of fs.readdirSync('base44/entities').filter(f => f !== 'User.jsonc')) {
  const rls = JSON.parse(fs.readFileSync(`base44/entities/${f}`, 'utf8')).rls || {};
  for (const op of ['create', 'read', 'update', 'delete']) assert.deepEqual(rls[op], { user_condition: { role: 'admin' } }, `${f}.${op}: solo administrador`);
}
console.log('✓ datos: configuración, operaciones, sesiones y alertas solo las ve y cambia el administrador');
console.log('\nTODO OK');
