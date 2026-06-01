import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const autoMode = payload.autoMode === true;
    const user = await base44.auth.me().catch(() => null);
    if (!autoMode && !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const scanner = await base44.functions.invoke('signalScanner', { autoMode: true });
    const execution = await base44.functions.invoke('tradingTick', { runOnce: true, autoMode: true });

    return Response.json({
      ok: true,
      loopTick: new Date().toISOString(),
      scanner: scanner.data || scanner,
      execution: execution.data || execution,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});