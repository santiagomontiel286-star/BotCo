import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function validateEnv() {
  const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'KRAKEN_LIVE_TRADING', 'BOTCO_LIVE_ENABLED', 'BOTCO_AUTOTRADE_INTERVAL_MINUTES'];
  const missing = required.filter(name => !Deno.env.get(name));
  const maxQuote = 25;
  if (missing.length) throw new Error(`Faltan variables LIVE: ${missing.join(', ')}`);
  if (!toBool(Deno.env.get('KRAKEN_LIVE_TRADING'))) throw new Error('KRAKEN_LIVE_TRADING debe ser true');
  if (!toBool(Deno.env.get('BOTCO_LIVE_ENABLED'))) throw new Error('BOTCO_LIVE_ENABLED debe ser true');
  return { maxQuote, maxOpenTrades: 1, minReservedQuote: 4, intervalMinutes: Math.max(1, Number(Deno.env.get('BOTCO_AUTOTRADE_INTERVAL_MINUTES') || '1')) };
}

let lastNonce = 0;
function nextNonce() { const now = Date.now() * 1000; lastNonce = Math.max(now, lastNonce + 1); return String(lastNonce); }
function getBalanceAmount(balances, currency) { return (currency === 'EUR' ? ['ZEUR', 'EUR'] : [currency]).reduce((sum, key) => sum + Number(balances[key] || 0), 0); }

async function signKraken(path, postData, secret) {
  const nonce = new URLSearchParams(postData).get('nonce') || '';
  const secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const sha256 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce + postData));
  const pathBytes = new TextEncoder().encode(path);
  const message = new Uint8Array(pathBytes.length + sha256.byteLength);
  message.set(pathBytes, 0);
  message.set(new Uint8Array(sha256), pathBytes.length);
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, message);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function getBalances() {
  const apiKey = Deno.env.get('KRAKEN_API_KEY');
  const apiSecret = Deno.env.get('KRAKEN_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Faltan KRAKEN_API_KEY o KRAKEN_API_SECRET');
  const path = '/0/private/Balance';
  const body = new URLSearchParams({ nonce: nextNonce() });
  const postData = body.toString();
  const response = await fetch(`https://api.kraken.com${path}`, { method: 'POST', headers: { 'API-Key': apiKey, 'API-Sign': await signKraken(path, postData, apiSecret), 'Content-Type': 'application/x-www-form-urlencoded' }, body: postData });
  const json = await response.json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return json.result;
}

function applyDynamicCapitalEnv(env, balances) {
  const balanceEUR = getBalanceAmount(balances || {}, 'EUR');
  return { ...env, maxQuote: balanceEUR > 0 ? Math.floor(balanceEUR * 0.85) : 25, maxOpenTrades: 1, minReservedQuote: 4 };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    let env = validateEnv();
    try { env = applyDynamicCapitalEnv(env, await getBalances()); } catch { env = applyDynamicCapitalEnv(env, null); }
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
        quote_currency: bot.quote_currency || 'EUR',
        strategy: bot.strategy || 'micro_scalp',
        last_run_at: now,
        last_signal: 'LIVE activado, esperando señal',
        last_error: '',
      });
    }

    const activeSessions = await entities.BotSession.filter({ active: true });
    for (const session of activeSessions) await entities.BotSession.update(session.id, { active: false, stopped_at: now });

    const assignedCapital = Number(payload.assignedCapital || env.maxQuote);
    const session = await entities.BotSession.create({
      active: true,
      mode: 'live',
      assigned_capital: assignedCapital,
      started_at: now,
      last_tick_at: now,
      risk_profile: payload.riskProfile || 'conservador',
      pairs: ['ADAEUR', 'XRPEUR', 'DOTEUR', 'LINKEUR', 'ATOMEUR', 'SOLEUR'],
      total_trades: 0,
      total_pnl: 0,
      last_error: '',
    });

    let firstCycle = null;
    try {
      const functionClient = base44.asServiceRole?.functions?.invoke ? base44.asServiceRole.functions : base44.functions;
      firstCycle = await functionClient.invoke('tradingLoop', { autoMode: true });
    } catch (error) {
      try {
        const functionClient = base44.asServiceRole?.functions?.invoke ? base44.asServiceRole.functions : base44.functions;
        const scanner = await functionClient.invoke('signalScanner', { autoMode: true });
        const execution = await functionClient.invoke('tradingTick', { runOnce: true, autoMode: true });
        firstCycle = { data: { fallback: true, scanner: scanner.data || scanner, execution: execution.data || execution } };
      } catch (fallbackError) {
        firstCycle = { data: { ok: false, error: fallbackError.message } };
      }
    }

    try {
      await entities.Alert.create({ title: 'Bots LIVE activados', message: `${bots.length} bots activados en Kraken Spot con máximo ${env.maxQuote} por orden. Primer ciclo oficial ejecutado.`, severity: 'warning', source: 'startLiveBots', is_read: false });
    } catch (error) {
      console.log(`Alert skipped: ${error.message}`);
    }
    return Response.json({ ok: true, session, bots: bots.length, env, firstCycle: firstCycle?.data || firstCycle, message: 'LIVE activado y primer ciclo oficial solicitado' });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});