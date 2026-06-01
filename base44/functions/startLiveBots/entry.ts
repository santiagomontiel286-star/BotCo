import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function validateEnv() {
  const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'KRAKEN_LIVE_TRADING', 'BOTCO_LIVE_ENABLED', 'MAX_LIVE_ORDER_QUOTE', 'BOTCO_AUTOTRADE_INTERVAL_MINUTES'];
  const missing = required.filter(name => !Deno.env.get(name));
  const maxQuote = Number(Deno.env.get('MAX_LIVE_ORDER_QUOTE') || '0');
  if (missing.length) throw new Error(`Faltan variables LIVE: ${missing.join(', ')}`);
  if (!toBool(Deno.env.get('KRAKEN_LIVE_TRADING'))) throw new Error('KRAKEN_LIVE_TRADING debe ser true');
  if (!toBool(Deno.env.get('BOTCO_LIVE_ENABLED'))) throw new Error('BOTCO_LIVE_ENABLED debe ser true');
  if (!maxQuote || maxQuote <= 0) throw new Error('MAX_LIVE_ORDER_QUOTE debe ser mayor que 0');
  if (maxQuote > 25) throw new Error('MAX_LIVE_ORDER_QUOTE supera 25; LIVE bloqueado');
  return { maxQuote, intervalMinutes: Number(Deno.env.get('BOTCO_AUTOTRADE_INTERVAL_MINUTES') || '5') };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const env = validateEnv();
    const entities = base44.asServiceRole.entities;
    const allBots = await entities.Bot.list();
    const selectedIds = Array.isArray(payload.botIds) ? payload.botIds : [];
    const bots = selectedIds.length ? allBots.filter(bot => selectedIds.includes(bot.id)) : allBots;
    if (!bots.length) return Response.json({ error: 'No hay bots para activar' }, { status: 400 });

    const now = new Date().toISOString();
    for (const bot of bots) {
      await entities.Bot.update(bot.id, {
        status: 'active',
        exchange: 'kraken',
        trading_mode: 'live',
        live_enabled: true,
        max_order_quote: Math.min(Number(bot.max_order_quote || bot.max_order_usd || env.maxQuote), env.maxQuote),
        quote_currency: bot.quote_currency || 'USD',
        strategy: bot.strategy || 'micro_scalp',
        last_run_at: now,
        last_signal: 'LIVE activado, esperando señal',
        last_error: '',
      });
    }

    const activeSessions = await entities.BotSession.filter({ active: true });
    for (const session of activeSessions) await entities.BotSession.update(session.id, { active: false, stopped_at: now });

    const assignedCapital = Number(payload.assignedCapital || env.maxQuote * bots.length);
    const session = await entities.BotSession.create({
      active: true,
      mode: 'live',
      assigned_capital: assignedCapital,
      started_at: now,
      last_tick_at: now,
      risk_profile: payload.riskProfile || 'conservador',
      pairs: ['XBTUSD', 'XBTEUR', 'ETHUSD', 'ETHEUR'],
      total_trades: 0,
      total_pnl: 0,
      last_error: '',
    });

    try {
      await entities.Alert.create({ title: 'Bots LIVE activados', message: `${bots.length} bots activados en Kraken Spot con máximo ${env.maxQuote} por orden. Ejecuta el ciclo manual o espera al cron.`, severity: 'warning', source: 'startLiveBots', is_read: false });
    } catch (error) {
      console.log(`Alert skipped: ${error.message}`);
    }
    return Response.json({ ok: true, session, bots: bots.length, env, message: 'LIVE activado sin ejecutar órdenes inmediatas para evitar rate limit' });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});