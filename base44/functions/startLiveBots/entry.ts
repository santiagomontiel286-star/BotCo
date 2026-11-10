import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Enciende el bot: crea una sesión activa en modo simulado o real según RiskConfig.mode.
// Simulado: cartera virtual de paper_capital_eur. Real: el capital es el saldo en EUR de Kraken.
let lastNonce = 0;
function nextNonce() { lastNonce = Math.max(Date.now() * 1000, lastNonce + 1); return String(lastNonce); }

async function krakenEurBalance() {
  const apiKey = Deno.env.get('KRAKEN_API_KEY');
  const apiSecret = Deno.env.get('KRAKEN_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Faltan las claves de Kraken en los secretos');
  const path = '/0/private/Balance';
  const postData = new URLSearchParams({ nonce: nextNonce() }).toString();
  const secretBytes = Uint8Array.from(atob(apiSecret), c => c.charCodeAt(0));
  const sha256 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(new URLSearchParams(postData).get('nonce') + postData));
  const pathBytes = new TextEncoder().encode(path);
  const message = new Uint8Array(pathBytes.length + sha256.byteLength);
  message.set(pathBytes, 0); message.set(new Uint8Array(sha256), pathBytes.length);
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sign = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, message))));
  const json = await (await fetch(`https://api.kraken.com${path}`, { method: 'POST', headers: { 'API-Key': apiKey, 'API-Sign': sign, 'Content-Type': 'application/x-www-form-urlencoded' }, body: postData })).json();
  if (json.error?.length) throw new Error(json.error.join(', '));
  return Number(json.result?.ZEUR || 0) + Number(json.result?.EUR || 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const entities = base44.asServiceRole.entities;

    const rows = await entities.RiskConfig.list('-created_date', 1);
    const config = (Array.isArray(rows) ? rows : rows?.items || [])[0] || {};
    const mode = config.mode === 'live' ? 'live' : 'paper';

    let capital;
    if (mode === 'live') {
      if (String(Deno.env.get('KRAKEN_LIVE_TRADING')).toLowerCase() !== 'true' || String(Deno.env.get('BOTCO_LIVE_ENABLED')).toLowerCase() !== 'true') {
        return Response.json({ ok: false, error: 'El modo real está bloqueado: KRAKEN_LIVE_TRADING y BOTCO_LIVE_ENABLED deben valer "true" en los secretos.' }, { status: 400 });
      }
      capital = await krakenEurBalance();
      if (capital < 10) return Response.json({ ok: false, error: `Saldo en Kraken insuficiente (${capital.toFixed(2)} €). Ingresa euros antes de operar en real.` }, { status: 400 });
    } else {
      capital = Number(config.paper_capital_eur || 50);
    }

    const now = new Date().toISOString();
    for (const s of await entities.BotSession.filter({ active: true })) await entities.BotSession.update(s.id, { active: false, stopped_at: now });
    const session = await entities.BotSession.create({
      active: true, mode: mode === 'live' ? 'live' : 'demo', assigned_capital: Number(capital.toFixed(2)), started_at: now,
      last_tick_at: now, last_cycle_status: 'ok', risk_profile: 'conservador', total_trades: 0, total_pnl: 0, last_error: ''
    });
    await entities.Alert.create({ title: mode === 'live' ? 'Bot encendido en REAL' : 'Bot encendido en SIMULADO', message: `Capital de la sesión: ${capital.toFixed(2)} €. El primer ciclo llega en menos de 5 minutos.`, severity: mode === 'live' ? 'warning' : 'info', source: 'startLiveBots', is_read: false }).catch(() => {});
    return Response.json({ ok: true, session });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});
