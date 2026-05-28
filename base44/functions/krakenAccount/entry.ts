import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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
  const res = await fetch(`https://api.kraken.com${path}`);
  return res.json();
}

// Maps Kraken asset codes to ticker pair symbols
const ASSET_TO_PAIR = {
  XXBT: 'XXBTZUSD', XBT: 'XXBTZUSD',
  XETH: 'XETHZUSD', ETH: 'XETHZUSD',
  XLTC: 'XLTCZUSD', LTC: 'XLTCZUSD',
  XXRP: 'XXRPZUSD', XRP: 'XXRPZUSD',
  XDOT: 'DOTUSD',   DOT: 'DOTUSD',
  SOL: 'SOLUSD',    USDT: 'USDTZUSD',
  USDC: 'USDCUSD',  ADA: 'ADAUSD',
  MATIC: 'MATICUSD', LINK: 'LINKUSD',
  ATOM: 'ATOMUSD',   AVAX: 'AVAXUSD',
  ZEUR: null, EUR: null, // will use EUR/USD rate
  ZUSD: null, USD: null, // already USD
};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Use keys from request payload if provided, else fall back to env vars
  let bodyApiKey, bodyApiSecret;
  try {
    const body = await req.json();
    bodyApiKey = body?.apiKey;
    bodyApiSecret = body?.apiSecret;
  } catch {}

  const KRAKEN_KEY = bodyApiKey || Deno.env.get('KRAKEN_API_KEY');
  const KRAKEN_SECRET = bodyApiSecret || Deno.env.get('KRAKEN_API_SECRET');

  if (!KRAKEN_KEY || !KRAKEN_SECRET) {
    return Response.json({ error: 'API keys no configuradas. Ve a Ajustes e introduce tus credenciales de Kraken.' }, { status: 400 });
  }

  // Override the private caller to use resolved keys
  const krakenPrivate = async (path, params = {}) => {
    const nonce = nextNonce();
    const postData = `nonce=${nonce}` + Object.entries(params).map(([k, v]) => `&${k}=${v}`).join('');
    const sign = await signKraken(path, postData, KRAKEN_SECRET);
    const res = await fetch(`https://api.kraken.com${path}`, {
      method: 'POST',
      headers: { 'API-Key': KRAKEN_KEY, 'API-Sign': sign, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
    });
    return res.json();
  };

  // 1. Fetch balance
  const balanceData = await krakenPrivate('/0/private/Balance');
  if (balanceData.error?.length) {
    return Response.json({ error: balanceData.error[0] }, { status: 400 });
  }

  // 2. Clean balance (non-zero only)
  const rawBalance = {};
  for (const [asset, amount] of Object.entries(balanceData.result || {})) {
    if (parseFloat(amount) > 0.000001) rawBalance[asset] = parseFloat(amount);
  }

  // 3. Collect pairs we need to price
  const pairsNeeded = new Set();
  for (const asset of Object.keys(rawBalance)) {
    const pair = ASSET_TO_PAIR[asset];
    if (pair) pairsNeeded.add(pair);
  }

  // 4. Fetch EUR/USD rate + all asset tickers in parallel
  const tickerPairsStr = [...pairsNeeded].join(',');
  const [tickerData, eurUsdData] = await Promise.all([
    tickerPairsStr ? krakenPublic(`/0/public/Ticker?pair=${tickerPairsStr}`) : Promise.resolve({ result: {} }),
    krakenPublic('/0/public/Ticker?pair=EURUSD'),
  ]);

  const prices = tickerData.result || {};
  const eurUsd = parseFloat(Object.values(eurUsdData.result || {})[0]?.c?.[0] || '1.08');

  // 5. Build enriched portfolio
  const portfolio = [];
  let totalUSD = 0;

  for (const [asset, amount] of Object.entries(rawBalance)) {
    let usdPrice = 1;
    const pair = ASSET_TO_PAIR[asset];

    if (asset === 'ZEUR' || asset === 'EUR') {
      usdPrice = eurUsd;
    } else if (asset === 'ZUSD' || asset === 'USD') {
      usdPrice = 1;
    } else if (pair && prices[pair]) {
      usdPrice = parseFloat(prices[pair].c[0]);
    } else if (pair) {
      // Try to find by matching pair key
      const found = Object.entries(prices).find(([k]) => k.includes(asset.replace('X','').replace('Z','')));
      usdPrice = found ? parseFloat(found[1].c[0]) : 0;
    }

    const usdValue = amount * usdPrice;
    totalUSD += usdValue;

    // Get 24h change
    let change24h = 0;
    if (pair && prices[pair]) {
      const open = parseFloat(prices[pair].o);
      change24h = open > 0 ? ((usdPrice - open) / open) * 100 : 0;
    }

    portfolio.push({
      asset,
      amount,
      usdPrice,
      usdValue: parseFloat(usdValue.toFixed(2)),
      change24h: parseFloat(change24h.toFixed(2)),
      pct_of_total: 0, // filled below
    });
  }

  // Fill % of total
  for (const p of portfolio) {
    p.pct_of_total = totalUSD > 0 ? parseFloat(((p.usdValue / totalUSD) * 100).toFixed(1)) : 0;
  }

  portfolio.sort((a, b) => b.usdValue - a.usdValue);

  // 6. Open orders
  const openOrdersData = await krakenPrivate('/0/private/OpenOrders', { trades: true });
  const openOrders = Object.values(openOrdersData.result?.open || {}).map(o => ({
    pair: o.descr?.pair,
    type: o.descr?.type,
    ordertype: o.descr?.ordertype,
    price: parseFloat(o.descr?.price || 0),
    vol: parseFloat(o.vol),
    vol_exec: parseFloat(o.vol_exec),
    status: o.status,
    opentm: new Date(o.opentm * 1000).toISOString(),
  }));

  // 7. Recent trades
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
    balance: rawBalance,         // raw asset → amount map (backwards compat)
    portfolio,                   // enriched: asset, amount, usdPrice, usdValue, change24h, pct_of_total
    totalUSD: parseFloat(totalUSD.toFixed(2)),
    openOrders,
    trades,
    fetchedAt: new Date().toISOString(),
  });
});