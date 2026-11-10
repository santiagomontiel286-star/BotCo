import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Apaga el bot. Con { closeOpenTrades: true } cierra antes las posiciones abiertas.
// Sin cerrar, las posiciones reales conservan su stop-loss en Kraken.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await req.json().catch(() => ({}));
    const entities = base44.asServiceRole.entities;

    let closeResult = null;
    if (payload.closeOpenTrades === true) {
      const res = await base44.functions.invoke('tradingLoop', { closeAll: true });
      closeResult = res?.data || res;
    }
    const now = new Date().toISOString();
    const sessions = await entities.BotSession.filter({ active: true });
    for (const s of sessions) await entities.BotSession.update(s.id, { active: false, stopped_at: now, last_cycle_status: 'ok' });
    await entities.Alert.create({ title: 'Bot apagado', message: payload.closeOpenTrades ? 'Se han cerrado las posiciones abiertas.' : 'Las posiciones abiertas se mantienen con su stop.', severity: 'info', source: 'stopLiveBots', is_read: false }).catch(() => {});
    return Response.json({ ok: true, stopped: sessions.length, closeResult });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});
