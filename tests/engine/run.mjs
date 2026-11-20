import assert from 'node:assert/strict';
const env = { KRAKEN_API_KEY: 'k', KRAKEN_API_SECRET: Buffer.from('secret').toString('base64'), KRAKEN_LIVE_TRADING: 'true', BOTCO_LIVE_ENABLED: 'true' };
globalThis.Deno = { env: { get: k => env[k] }, serve: fn => { globalThis.__handler = fn; } };
globalThis.__db = {};
const M = globalThis.__market = { privateCalls: [], balance: { ZEUR: '50' }, orders: {}, open: {} };
const now = Date.now(); const B = 300; const H = 3600;
const curBar = Math.floor(now / 1000 / B) * B;
const curHour = Math.floor(now / 1000 / H) * H;
// Velas de 5 min (para vigilar posiciones abiertas en simulado)
function c5() {
  const rows = [];
  for (let t = curBar - 7200; t <= curBar; t += B) rows.push([t, '100', '100.3', '99.8', '100.1', '0', '10', 1]);
  return rows;
}
// Velas de 1 h: 30 días planos entre 99 y 101; con ruptura, la última vela cerrada cierra en 101,5 con volumen
function h60(breakout) {
  const rows = [];
  for (let t = curHour - 720 * H; t <= curHour; t += H) {
    let o = 100, h = 101, l = 99, c = 100, v = 10;
    if (breakout && t === curHour - H) { c = 101.5; h = 101.7; v = 30; }
    if (t === curHour) { c = breakout ? 101.6 : 100; }
    rows.push([t, String(o), String(h), String(l), String(c), '0', String(v), 1]);
  }
  return rows;
}
const OHLC = { 5: {}, 60: { ETHEUR: h60(true) } };
globalThis.fetch = async (url, init) => {
  const u = new URL(url); const ep = u.pathname.split('/').pop(); const pair = u.searchParams.get('pair');
  const ok = result => ({ json: async () => ({ error: [], result }) });
  if (u.pathname.includes('/public/')) {
    if (ep === 'Ticker') { const eth = pair === 'ETHEUR' && M.ethPrice; const p = eth || (pair === 'ETHEUR' ? 101.58 : 100.1); return ok({ [pair]: { a: [String(p + 0.03)], b: [String(p - 0.02)], c: [String(p)], o: '100' } }); }
    if (ep === 'AssetPairs') return ok({ [pair]: { status: 'online', ordermin: '0.002', costmin: '0.5', lot_decimals: 8, pair_decimals: 2 } });
    if (ep === 'OHLC') { const iv = u.searchParams.get('interval'); return ok({ [pair]: iv === '60' ? (OHLC[60][pair] || h60(false)) : (OHLC[5][pair] || c5()), last: 0 }); }
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
const call = async (body = { autoMode: true }) => (await globalThis.__handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))).json();
const db = globalThis.__db;
// Perfil de prueba: velas de 1 h, objetivo fijo 3R y Máquina del Tiempo sin veto (datos sintéticos)
const cfgBase = { profile: 'agresivo', trend_ema: 0, target_r: 3, atr_mult: 2, tm_min_edge_points: -100, max_loss_per_trade_eur: 0.5, max_daily_loss_eur: 1.5, max_open_trades: 1 };

// ── 0. Perfiles ──
const E = await import('./.loop.mjs');
assert.equal(E.resolveConfig({}).profile, 'equilibrado');
assert.equal(E.resolveConfig({ target_r: 3, max_hold_minutes: 240, entry_window_utc_start: '07:15', tm_min_edge_points: 5 }).max_hold_minutes, E.PROFILES.equilibrado.max_hold_minutes, 'registro antiguo → perfil equilibrado, sin sus valores viejos');
assert.equal(E.resolveConfig({ kill_switch: true, mode: 'live' }).kill_switch, true, 'registro antiguo conserva ajustes generales');
assert.equal(E.resolveConfig({ profile: 'cauteloso' }).timeframe_minutes, 1440);
assert.equal(E.resolveConfig({ profile: 'agresivo', max_loss_per_trade_eur: '0.8' }).max_loss_per_trade_eur, 0.8, 'ajuste personalizado');
assert.equal(E.resolveConfig({ profile: 'agresivo', timeframe_minutes: 7 }).timeframe_minutes, 60, 'marco temporal inválido → el del perfil');
console.log('✓ perfiles: registro antiguo → equilibrado; personalizaciones y valores inválidos');

// ── 1. Bot apagado ──
db.RiskConfig = [{ id: 'rc', ...cfgBase }];
let r = await call(); assert.equal(r.skipped, true); console.log('✓ bot apagado: no hace nada');

// ── 2. SIMULADO: compra ──
db.BotSession = [{ id: 'S1', active: true, mode: 'demo', assigned_capital: 50, started_at: new Date(now - 3600e3).toISOString() }];
r = await call();
assert.equal(r.ok, true, JSON.stringify(r));
assert.equal(r.profile, 'agresivo'); assert.equal(r.timeframe, 60);
const eth = r.agents.find(a => a.pair === 'ETH/EUR');
assert.equal(eth.ok, true, JSON.stringify(eth));
assert.ok(r.agents.filter(a => a.pair !== 'ETH/EUR').every(a => a.reason.startsWith('Entrada:')), 'otros pares esperan ruptura');
let t = db.Trade[0];
assert.equal(t.mode, 'demo'); assert.equal(t.session_id, 'S1'); assert.equal(t.profile, 'agresivo');
assert.ok(t.stop_loss > 96 && t.stop_loss < 99, 'stop por ATR ' + t.stop_loss);
assert.ok(Math.abs(t.take_profit - (101.5 + 3 * (101.5 - t.stop_loss))) < 0.02, 'objetivo 3R ' + t.take_profit);
const maxLoss = (t.entry_price - t.stop_loss) * t.amount + t.cost * 0.008;
assert.ok(maxLoss <= 0.5 + 1e-6, 'pérdida máxima ' + maxLoss);
assert.equal(M.privateCalls.filter(c => c.ep === 'AddOrder').length, 0, 'simulado no toca Kraken');
console.log(`✓ simulado: compra ${t.amount} ETH a ${t.entry_price.toFixed(2)} (${t.cost.toFixed(2)} €), stop ${t.stop_loss}, objetivo ${t.take_profit}, pérdida máx ${maxLoss.toFixed(3)} €`);

// ── 3. Lock: ciclo en marcha ──
db.BotSession[0].last_cycle_status = 'running'; db.BotSession[0].last_cycle_started_at = new Date().toISOString();
r = await call(); assert.equal(r.skipped, true); db.BotSession[0].last_cycle_status = 'ok';
console.log('✓ bloqueo: no corre dos ciclos a la vez');

// ── 4. SIMULADO: llega al objetivo ──
t.entry_date = new Date(now - 30 * 60e3).toISOString();
OHLC[5].ETHEUR = [...c5().slice(0, -1), [curBar, '101.6', String(t.take_profit + 0.5), '101.5', String(t.take_profit + 0.2), '0', '9', 1], [curBar + B, '109', '109', '109', '109', '0', '1', 1]];
await wait(); r = await call();
t = db.Trade[0];
assert.equal(t.status, 'closed'); assert.equal(t.exit_reason, 'target'); assert.ok(t.profit_loss > 0);
assert.ok(r.agents.find(a => a.pair === 'ETH/EUR').reason.includes('se operó hace poco'), 'pausa por par');
console.log(`✓ simulado: cierra en objetivo con +${t.profit_loss.toFixed(3)} € (comisiones incluidas) y no repite ETH enseguida`);

// ── 5. Protecciones: stop reciente → pausa ──
db.Trade.push({ id: 'old', mode: 'demo', session_id: 'S1', pair: 'SOL/EUR', status: 'closed', exit_reason: 'stop', profit_loss: -0.4, entry_date: new Date(now - 90 * 60e3).toISOString(), exit_date: new Date(now - 10 * 60e3).toISOString(), cost: 10 });
delete OHLC[5].ETHEUR; db.Trade[0].pair = 'ADA/EUR';
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
assert.deepEqual(adds.map(a => a.ordertype), ['market', 'stop-loss']); assert.equal(adds[1].price, t.stop_loss.toFixed(2));
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
db.Trade = []; db.BotSession[0].last_cycle_status = 'ok'; M.balance = { ZEUR: '50' };
await wait(); r = await call(); t = db.Trade.find(x => x.status === 'open'); assert.ok(t);
M.balance = { ZEUR: '35', XETH: String(t.amount) }; M.privateCalls = [];
r = await call({ closeTradeId: t.id });
const seq = M.privateCalls.map(c => c.ep + (c.ordertype ? ':' + c.ordertype : ''));
assert.ok(seq.indexOf('CancelOrder') < seq.indexOf('AddOrder:market'), seq.join(','));
t = db.Trade.find(x => x.id === t.id); assert.equal(t.status, 'closed'); assert.equal(t.exit_reason, 'manual');
console.log('✓ real: cierre manual cancela el stop antes de vender (' + seq.join(' → ') + ')');

// ── 10. Modo real bloqueado sin secretos ──
env.BOTCO_LIVE_ENABLED = 'false'; db.BotSession[0].last_cycle_status = 'ok';
r = await call(); assert.equal(r.ok, false); assert.match(r.error, /bloqueado/); env.BOTCO_LIVE_ENABLED = 'true';
console.log('✓ real bloqueado si los secretos no lo permiten');

// ── 11. Stop móvil (sin objetivo fijo) en SIMULADO ──
const raiseLows = () => { const rows = h60(true); for (const row of rows.slice(-5, -1)) { row[3] = '100.5'; } return rows; };
db.RiskConfig[0] = { id: 'rc', ...cfgBase, target_r: 0, trail_exit_bars: 3 };
db.Trade = []; M.ethPrice = 0; OHLC[60].ETHEUR = h60(true);
db.BotSession = [{ id: 'S2', active: true, mode: 'demo', assigned_capital: 50, started_at: new Date(now - 3600e3).toISOString() }];
await wait(); r = await call(); t = db.Trade.find(x => x.status === 'open');
assert.ok(t, JSON.stringify(r.agents.find(a => a.pair === 'ETH/EUR'))); assert.equal(t.take_profit, 0); assert.equal(t.trailing, true);
const firstStop = t.stop_loss;
OHLC[60].ETHEUR = raiseLows(); M.ethPrice = 103;
await wait(); r = await call(); t = db.Trade.find(x => x.id === t.id);
assert.equal(t.status, 'open'); assert.equal(t.stop_loss, 100.5, 'stop subido'); assert.ok(t.stop_updated_at);
await wait(); r = await call(); t = db.Trade.find(x => x.id === t.id);
assert.equal(t.status, 'open', 'velas anteriores al cambio de stop no lo disparan');
OHLC[60].ETHEUR = h60(true);
await wait(); r = await call(); t = db.Trade.find(x => x.id === t.id); assert.equal(t.stop_loss, 100.5, 'el stop nunca baja');
console.log(`✓ stop móvil (simulado): ${firstStop} → 100.5, no se aplica al pasado y nunca baja`);

// ── 12. Stop móvil en REAL: cancela el stop viejo y pone el nuevo en Kraken ──
db.Trade = []; M.ethPrice = 0; M.balance = { ZEUR: '50' }; OHLC[60].ETHEUR = h60(true);
db.BotSession = [{ id: 'L2', active: true, mode: 'live', assigned_capital: 50, started_at: new Date(now - 3600e3).toISOString() }];
await wait(); r = await call(); t = db.Trade.find(x => x.status === 'open'); assert.ok(t && t.exchange_stop_txid);
const oldTx = t.exchange_stop_txid;
OHLC[60].ETHEUR = raiseLows(); M.ethPrice = 103; M.privateCalls = [];
await wait(); r = await call(); t = db.Trade.find(x => x.id === t.id);
const seq2 = M.privateCalls.map(c => c.ep + (c.ordertype ? ':' + c.ordertype : ''));
assert.ok(seq2.indexOf('CancelOrder') >= 0 && seq2.indexOf('CancelOrder') < seq2.indexOf('AddOrder:stop-loss'), seq2.join(','));
assert.equal(M.privateCalls.find(c => c.ordertype === 'stop-loss').price, '100.50');
assert.notEqual(t.exchange_stop_txid, oldTx); assert.equal(t.stop_loss, 100.5); assert.equal(seq2.filter(x => x === 'AddOrder:market').length, 0, 'no vende');
console.log(`✓ stop móvil (real): cancela ${oldTx} y pone el nuevo stop 100.50 en Kraken (${t.exchange_stop_txid})`);
console.log('\nTODO OK');
