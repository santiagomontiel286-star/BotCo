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

async function krakenPrivate(path, params = {}) {
  const apiKey = Deno.env.get('KRAKEN_API_KEY');
  const apiSecret = Deno.env.get('KRAKEN_API_SECRET');
  const nonce = Date.now().toString();
  const postData = `nonce=${nonce}` + Object.entries(params).map(([k, v]) => `&${k}=${v}`).join('');
  const sign = await signKraken(path, postData, apiSecret);

  const res = await fetch(`https://api.kraken.com${path}`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': sign,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  });
  return res.json();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const [balanceData, tradesData, openOrdersData] = await Promise.all([
    krakenPrivate('/0/private/Balance'),
    krakenPrivate('/0/private/TradesHistory', { trades: true }),
    krakenPrivate('/0/private/OpenOrders', { trades: true }),
  ]);

  if (balanceData.error?.length) {
    return Response.json({ error: balanceData.error[0] }, { status: 400 });
  }

  // Clean up balance (remove zero balances)
  const balance = {};
  for (const [asset, amount] of Object.entries(balanceData.result || {})) {
    if (parseFloat(amount) > 0) balance[asset] = parseFloat(amount);
  }

  // Summarize trades
  const trades = Object.values(tradesData.result?.trades || {}).slice(0, 50).map(t => ({
    id: t.ordertxid,
    pair: t.pair,
    type: t.type,
    ordertype: t.ordertype,
    price: parseFloat(t.price),
    cost: parseFloat(t.cost),
    fee: parseFloat(t.fee),
    vol: parseFloat(t.vol),
    margin: parseFloat(t.margin),
    net: parseFloat(t.net || 0),
    time: new Date(t.time * 1000).toISOString(),
  }));

  const openOrders = Object.values(openOrdersData.result?.open || {}).map(o => ({
    descr: o.descr,
    vol: parseFloat(o.vol),
    vol_exec: parseFloat(o.vol_exec),
    cost: parseFloat(o.cost),
    status: o.status,
    opentm: new Date(o.opentm * 1000).toISOString(),
  }));

  return Response.json({ balance, trades, openOrders });
});