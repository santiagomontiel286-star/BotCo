import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = 'https://api.kraken.com';
const EUR_KEYS = ['ZEUR', 'EUR'];
const ASSET_TO_EUR_PAIR = {
  XXBT: 'XBTEUR', XBT: 'XBTEUR',
  XETH: 'ETHEUR', ETH: 'ETHEUR',
  SOL: 'SOLEUR',
  XXRP: 'XRPEUR', XRP: 'XRPEUR',
  ADA: 'ADAEUR',
  DOT: 'DOTEUR',
  LINK: 'LINKEUR',
  ATOM: 'ATOMEUR',
};
const DISPLAY_PAIRS = { XBTEUR: 'BTC/EUR', ETHEUR: 'ETH/EUR', SOLEUR: 'SOL/EUR', XRPEUR: 'XRP/EUR', ADAEUR: 'ADA/EUR', DOTEUR: 'DOT/EUR', LINKEUR: 'LINK/EUR', ATOMEUR: 'ATOM/EUR' };

// Única fuente de verdad del capital real en EUR
function getCapitalEUR(balances) {
  return EUR_KEYS.reduce((sum, key) => sum + Number(balances?.[key] || 0), 0);
}

async function signKraken(path, postData, secret) {
  const nonce = postData.match(/nonce=(\d+)/)[1];
  const secretBuffer = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const sha256Hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce + postData));
  const message = new Uint8Array([...new TextEncoder().encode(path), ...new Uint8Array(sha256Hash)]);
  const key = await crypto.subtle.importKey('raw', secretBuffer, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, message);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

let lastNonce = 0;
function nextNonce() {
  const n = Math.max(Date.now() * 1000, lastNonce + 1);
  lastNonce = n;
  return n.toString();
}

async function krakenPublic(path) {
  const res = await fetch(`${KRAKEN_API}${path}`);
  return res.json();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Solo secretos del backend: nunca se aceptan claves desde el cuerpo de la petición.
  const KRAKEN_KEY = Deno.env.get('KRAKEN_API_KEY');
  const KRAKEN_SECRET = Deno.env.get('KRAKEN_API_SECRET');

  if (!KRAKEN_KEY || !KRAKEN_SECRET) {
    return Response.json({ error: 'API keys no configuradas en los secretos del backend.' }, { status: 400 });
  }

  const krakenPrivate = async (path, params = {}) => {
    const nonce = nextNonce();
    const postData = `nonce=${nonce}` + Object.entries(params).map(([k, v]) => `&${k}=${v}`).join('');
    const sign = await signKraken(path, postData, KRAKEN_SECRET);
    const res = await fetch(`${KRAKEN_API}${path}`, {
      method: 'POST',
      headers: { 'API-Key': KRAKEN_KEY, 'API-Sign': sign, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
    });
    return res.json();
  };

  // 1. Balance
  const balanceData = await krakenPrivate('/0/private/Balance');
  if (balanceData.error?.length) {
    return Response.json({ error: balanceData.error[0] }, { status: 400 });
  }

  const rawBalance = {};
  for (const [asset, amount] of Object.entries(balanceData.result || {})) {
    if (parseFloat(amount) > 0.000001) rawBalance[asset] = parseFloat(amount);
  }

  // 2. Pares EUR que necesitamos valorar + reglas (decimales de precio, mínimos)
  const pairSet = new Set();
  for (const asset of Object.keys(rawBalance)) {
    const pair = ASSET_TO_EUR_PAIR[asset];
    if (pair) pairSet.add(pair);
  }
  const requestedPairs = [...pairSet];
  const pairMeta = {};

  if (requestedPairs.length) {
    const pairsData = await krakenPublic(`/0/public/AssetPairs?pair=${requestedPairs.join(',')}`);
    for (const [key, info] of Object.entries(pairsData.result || {})) {
      const alt = String(info.altname || key).replace('/', '').toUpperCase();
      pairMeta[alt] = {
        key,
        pair: DISPLAY_PAIRS[alt] || alt,
        decimals: Number(info.pair_decimals ?? 2),
        lot_decimals: Number(info.lot_decimals ?? 8),
        ordermin: Number(info.ordermin || 0),
        costmin: Number(info.costmin || 0),
        status: String(info.status || 'online'),
      };
    }
  }

  // 3. Precios en EUR + tasa EUR/USD solo para los campos heredados
  const [tickerData, eurUsdData] = await Promise.all([
    requestedPairs.length ? krakenPublic(`/0/public/Ticker?pair=${requestedPairs.join(',')}`) : Promise.resolve({ result: {} }),
    krakenPublic('/0/public/Ticker?pair=EURUSD'),
  ]);
  const prices = tickerData.result || {};
  const eurUsd = parseFloat(Object.values(eurUsdData.result || {})[0]?.c?.[0] || '1');

  const portfolio = [];
  let totalEUR = 0;

  for (const [asset, amount] of Object.entries(rawBalance)) {
    const meta = pairMeta[ASSET_TO_EUR_PAIR[asset]] || null;
    const ticker = meta ? prices[meta.key] : null;
    // El efectivo en euros vale 1 € por unidad (antes no contaba en el total)
    const isEUR = EUR_KEYS.includes(asset);
    const priceEUR = isEUR ? 1 : ticker ? parseFloat(ticker.c[0]) : 0;
    const valueEUR = amount * priceEUR;
    const open = ticker ? parseFloat(ticker.o) : 0;
    const change24h = !isEUR && open > 0 ? ((priceEUR - open) / open) * 100 : 0;

    totalEUR += valueEUR;
    portfolio.push({
      asset: isEUR ? 'EUR' : asset,
      sellable: isEUR || !meta || (amount >= meta.ordermin && valueEUR >= meta.costmin),
      amount,
      decimals: meta?.decimals ?? 2,
      priceEUR,
      valueEUR: parseFloat(valueEUR.toFixed(6)),
      // Campos heredados para las vistas que aún muestran USD
      usdPrice: parseFloat((priceEUR * eurUsd).toFixed(6)),
      usdValue: parseFloat((valueEUR * eurUsd).toFixed(2)),
      change24h: parseFloat(change24h.toFixed(2)),
      pct_of_total: 0,
    });
  }

  for (const p of portfolio) {
    p.pct_of_total = totalEUR > 0 ? parseFloat(((p.valueEUR / totalEUR) * 100).toFixed(1)) : 0;
  }
  portfolio.sort((a, b) => b.valueEUR - a.valueEUR);

  // 4. Órdenes abiertas + trades recientes
  const openOrdersData = await krakenPrivate('/0/private/OpenOrders', { trades: true });
  const openOrders = Object.entries(openOrdersData.result?.open || {}).map(([txid, o]) => ({
    txid,
    pair: o.descr?.pair,
    type: o.descr?.type,
    ordertype: o.descr?.ordertype,
    price: parseFloat(o.descr?.price || 0),
    vol: parseFloat(o.vol),
    vol_exec: parseFloat(o.vol_exec),
    status: o.status,
    opentm: new Date(o.opentm * 1000).toISOString(),
  }));

  const tradesData = await krakenPrivate('/0/private/TradesHistory', { trades: true });
  const trades = Object.values(tradesData.result?.trades || {}).slice(0, 30).map(t => ({
    pair: t.pair,
    type: t.type,
    ordertype: t.ordertype,
    price: parseFloat(t.price),
    vol: parseFloat(t.vol),
    cost: parseFloat(t.cost),
    fee: parseFloat(t.fee),
    net: parseFloat(t.net || 0),
    time: new Date(t.time * 1000).toISOString(),
  }));

  return Response.json({
    balance: rawBalance,
    capitalEUR: parseFloat(getCapitalEUR(rawBalance).toFixed(8)),
    totalEUR: parseFloat(totalEUR.toFixed(6)),
    totalUSD: parseFloat((totalEUR * eurUsd).toFixed(2)),
    portfolio,
    pairs: Object.values(pairMeta),
    openOrders,
    trades,
    fetchedAt: new Date().toISOString(),
  });
});