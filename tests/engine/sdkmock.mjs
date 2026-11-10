let seq = 0;
function table(name) {
  const db = globalThis.__db; db[name] ||= [];
  const rows = db[name];
  const match = (r, q) => Object.entries(q || {}).every(([k, v]) => r[k] === v);
  const sort = (arr, s) => { if (!s) return arr; const desc = s.startsWith('-'); const k = s.replace('-', ''); return [...arr].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (desc ? -1 : 1)); };
  return {
    filter: async (q, s, l) => sort(rows.filter(r => match(r, q)), s).slice(0, l || 1e9).map(r => ({ ...r })),
    list: async (s, l) => sort(rows, s).slice(0, l || 1e9).map(r => ({ ...r })),
    create: async data => { const r = { id: `${name}_${++seq}`, created_date: new Date(Date.now() + seq).toISOString(), ...data }; rows.push(r); return { ...r }; },
    update: async (id, data) => { const r = rows.find(x => x.id === id); if (!r) throw new Error('no row ' + id); Object.assign(r, data); return { ...r }; },
  };
}
export function createClientFromRequest() {
  return { asServiceRole: { entities: new Proxy({}, { get: (_, n) => table(n) }) }, auth: { me: async () => ({ id: 'u1' }) }, functions: { invoke: async () => ({}) } };
}
