import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const entities = base44.asServiceRole.entities;
    let closeResult = null;
    if (payload.closeOpenTrades === true) {
      const tick = await base44.functions.invoke('tradingTick', { forceClose: true });
      closeResult = tick.data || tick;
    }

    const now = new Date().toISOString();
    const bots = await entities.Bot.list();
    for (const bot of bots.filter(item => item.trading_mode === 'live' || item.live_enabled === true)) {
      await entities.Bot.update(bot.id, { live_enabled: false, status: 'stopped', last_run_at: now, last_signal: 'LIVE detenido por usuario' });
    }

    const sessions = await entities.BotSession.filter({ active: true });
    for (const session of sessions) await entities.BotSession.update(session.id, { active: false, stopped_at: now });

    await entities.Alert.create({ title: 'Bots LIVE detenidos', message: payload.closeOpenTrades === true ? 'Bots LIVE detenidos y cierre de operaciones solicitado.' : 'Bots LIVE detenidos sin cierre forzado.', severity: 'info', source: 'stopLiveBots', is_read: false });
    return Response.json({ ok: true, stoppedBots: bots.length, closeResult });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});