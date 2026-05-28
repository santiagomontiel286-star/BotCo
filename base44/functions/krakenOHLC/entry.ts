import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pair = body.pair || 'XBTUSD';
  const interval = body.interval || 60; // minutes: 1, 5, 15, 30, 60, 240, 1440

  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error?.length) {
    return Response.json({ error: data.error[0] }, { status: 400 });
  }

  const key = Object.keys(data.result).find(k => k !== 'last');
  const candles = (data.result[key] || []).slice(-60).map(c => ({
    t: new Date(c[0] * 1000).toISOString(),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vwap: parseFloat(c[5]),
    volume: parseFloat(c[6]),
    trades: c[7],
  }));

  return Response.json({ pair, interval, candles });
});