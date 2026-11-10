import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Precios actuales en EUR de los pares que opera el bot
const PAIRS = ['XBTEUR', 'ETHEUR', 'SOLEUR', 'XRPEUR', 'ADAEUR', 'DOTEUR', 'LINKEUR', 'ATOMEUR'];
const DISPLAY = { XBTEUR: 'BTC/EUR', ETHEUR: 'ETH/EUR', SOLEUR: 'SOL/EUR', XRPEUR: 'XRP/EUR', ADAEUR: 'ADA/EUR', DOTEUR: 'DOT/EUR', LINKEUR: 'LINK/EUR', ATOMEUR: 'ATOM/EUR' };

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const [tickers, assetPairs] = await Promise.all([
    fetch(`https://api.kraken.com/0/public/Ticker?pair=${PAIRS.join(',')}`).then(r => r.json()),
    fetch(`https://api.kraken.com/0/public/AssetPairs?pair=${PAIRS.join(',')}`).then(r => r.json()),
  ]);
  if (tickers.error?.length) return Response.json({ error: tickers.error[0] }, { status: 400 });
  const prices = {};
  for (const [key, info] of Object.entries(assetPairs.result || {})) {
    const alt = String(info.altname || key).toUpperCase();
    const t = tickers.result?.[key];
    if (!t) continue;
    const last = Number(t.c[0]); const open = Number(t.o);
    prices[DISPLAY[alt] || alt] = { last, bid: Number(t.b[0]), ask: Number(t.a[0]), changePct: open ? (last - open) / open * 100 : 0, decimals: Number(info.pair_decimals ?? 2) };
  }
  return Response.json({ prices, fetchedAt: new Date().toISOString() });
});
