import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const pairs = ['XBTUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD', 'DOTUSD', 'LINKUSD'];
  const url = `https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error && data.error.length > 0) {
    return Response.json({ error: data.error[0] }, { status: 400 });
  }

  const tickers = {};
  for (const [key, val] of Object.entries(data.result)) {
    tickers[key] = {
      last: parseFloat(val.c[0]),
      open: parseFloat(val.o),
      high: parseFloat(val.h[1]),
      low: parseFloat(val.l[1]),
      volume: parseFloat(val.v[1]),
      vwap: parseFloat(val.p[1]),
      trades: val.t[1],
      change: ((parseFloat(val.c[0]) - parseFloat(val.o)) / parseFloat(val.o) * 100).toFixed(2),
    };
  }

  return Response.json({ tickers });
});