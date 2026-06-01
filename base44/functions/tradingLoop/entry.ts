import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function invokeFunction(base44, name, payload) {
  const serviceFunctions = base44.asServiceRole?.functions;
  const client = serviceFunctions?.invoke ? serviceFunctions : base44.functions;
  return client.invoke(name, payload);
}

function dataOf(response) {
  return response?.data || response || {};
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    console.log(`tradingLoop url: ${req.url}`);
    const payload = await req.json().catch(() => ({}));
    const autoMode = payload.autoMode === true;
    const user = await base44.auth.me().catch(() => null);
    if (!autoMode && !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const scanner = dataOf(await invokeFunction(base44, 'signalScanner', { autoMode: true }));
    const execution = dataOf(await invokeFunction(base44, 'tradingTick', { runOnce: true, autoMode: true }));
    const summary = {
      ok: scanner.ok !== false && execution.ok !== false,
      loopTick: new Date().toISOString(),
      scannedPairs: scanner.scannedPairs || execution.scannedPairs || [],
      signalsCreated: Number(scanner.signalsCreated || 0),
      signalsAccepted: Number(execution.signalsAccepted || 0),
      tradesOpened: Number(execution.tradesOpened || 0),
      tradesClosed: Number(execution.tradesClosed || 0),
      reasons: [...(scanner.reasons || []), ...(execution.reasons || [])].slice(0, 20),
      scannerTick: scanner.scannerTick,
      executionTick: execution.executionTick,
      scanner,
      execution,
    };

    const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true }, '-created_date', 1);
    if (sessions[0]?.id) {
      await base44.asServiceRole.entities.BotSession.update(sessions[0].id, {
        last_tick_at: summary.loopTick,
        last_scanner_at: summary.scannerTick,
        last_execution_at: summary.executionTick,
        last_cycle_summary: JSON.stringify({
          loopTick: summary.loopTick,
          scannedPairs: summary.scannedPairs,
          signalsCreated: summary.signalsCreated,
          signalsAccepted: summary.signalsAccepted,
          tradesOpened: summary.tradesOpened,
          tradesClosed: summary.tradesClosed,
          reasons: summary.reasons.slice(0, 10),
        }),
        last_error: (summary.tradesOpened || summary.tradesClosed) ? '' : (summary.reasons[0]?.reason || summary.reasons[0]?.message || ''),
      });
    }

    return Response.json(summary);
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});