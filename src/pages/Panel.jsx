import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Power, Building2, AlertTriangle, Loader2, ArrowRight, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import useKrakenData from "@/hooks/useKrakenData";
import { useBot, eur, signedEur, pct, fmtPair, EXIT_LABELS } from "@/hooks/useBot";

function Stat({ label, value, sub, tone }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-mono font-semibold mt-1", tone === "up" ? "text-primary" : tone === "down" ? "text-destructive" : "text-foreground")}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function OpenPosition({ trade, prices, onClose, closing }) {
  const pair = fmtPair(trade.pair);
  const live = prices?.[pair];
  const price = live?.bid ?? null;
  const entry = Number(trade.entry_price); const stop = Number(trade.stop_loss); const target = Number(trade.take_profit);
  const pnl = price != null ? (price - entry) * Number(trade.amount) - Number(trade.fee || 0) * 2 : null;
  const pnlPct = pnl != null && Number(trade.cost) > 0 ? pnl / Number(trade.cost) * 100 : null;
  const progress = price != null && target > stop ? Math.min(100, Math.max(0, (price - stop) / (target - stop) * 100)) : null;
  const entryPos = target > stop ? (entry - stop) / (target - stop) * 100 : 0;
  const d = live?.decimals ?? 2;
  const minutes = Math.round((Date.now() - new Date(trade.entry_date || trade.created_date).getTime()) / 60000);
  return (
    <div className="bg-card rounded-xl border border-primary/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Posición abierta · hace {minutes} min</p>
          <p className="text-lg font-semibold text-foreground mt-0.5">{pair} <span className="text-sm font-normal text-muted-foreground">{Number(trade.amount)} · {eur(trade.cost)}</span></p>
        </div>
        <div className="text-right">
          <p className={cn("text-xl font-mono font-semibold", pnl == null ? "text-muted-foreground" : pnl >= 0 ? "text-primary" : "text-destructive")}>{pnl == null ? "—" : signedEur(pnl)}</p>
          <p className="text-[11px] text-muted-foreground">{pnlPct == null ? "cargando precio…" : `${pct(pnlPct)} · estimado con comisiones`}</p>
        </div>
      </div>
      <div className="mt-5">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-destructive/40 via-muted to-primary/40">
          <span className="absolute -top-1 w-0.5 h-4 bg-muted-foreground/70" style={{ left: `${entryPos}%` }} title="Entrada" />
          {progress != null && <span className="absolute -top-1.5 w-3 h-5 -ml-1.5 rounded-sm bg-foreground border-2 border-background" style={{ left: `${progress}%` }} title="Precio actual" />}
        </div>
        <div className="flex justify-between text-[11px] font-mono mt-2">
          <span className="text-destructive">Stop {stop.toFixed(d)}</span>
          <span className="text-muted-foreground">Entrada {entry.toFixed(d)}{price != null ? ` · ahora ${price.toFixed(d)}` : ""}</span>
          <span className="text-primary">Objetivo {target.toFixed(d)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
        <p className="text-[11px] text-muted-foreground">{trade.mode === "live" ? (trade.exchange_stop_txid ? "Stop-loss activo en Kraken." : "Comprobando el stop en Kraken…") : "Operación simulada."} {trade.last_error ? <span className="text-destructive">Último error: {trade.last_error}</span> : null}</p>
        <Button size="sm" variant="outline" onClick={onClose} disabled={closing}>{closing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}Cerrar ahora</Button>
      </div>
    </div>
  );
}

export default function Panel() {
  const bot = useBot();
  const { session, running, mode, sessionTrades, summary, config } = bot;
  const live = mode === "live";
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null); // 'start-live' | 'stop' | {close: trade}
  const kraken = useKrakenData({ intervalMs: 60000 });

  const open = sessionTrades.filter(t => t.status === "open");
  const closed = sessionTrades.filter(t => t.status === "closed").sort((a, b) => new Date(a.exit_date) - new Date(b.exit_date));
  const { data: prices } = useQuery({
    queryKey: ["prices"], enabled: open.length > 0, refetchInterval: 15000,
    queryFn: async () => (await base44.functions.invoke("krakenTicker", {}))?.data?.prices || {},
  });

  const startCapital = Number(session?.assigned_capital || 0);
  const result = closed.reduce((s, t) => s + Number(t.profit_loss || 0), 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const today = closed.filter(t => new Date(t.exit_date) >= todayStart).reduce((s, t) => s + Number(t.profit_loss || 0), 0);
  const wins = closed.filter(t => Number(t.profit_loss) > 0).length;
  let acc = 0;
  const curve = [{ label: "Inicio", value: startCapital }, ...closed.map(t => ({ label: new Date(t.exit_date).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }), value: Number((startCapital + (acc += Number(t.profit_loss || 0))).toFixed(2)) }))];

  const lastTick = session?.last_tick_at ? new Date(session.last_tick_at).getTime() : 0;
  const stale = running && lastTick && Date.now() - lastTick > 8 * 60000;
  const failed = running && session?.last_cycle_status === "failed";
  const signals = (summary.agents || []).filter(a => a.ok).length;
  const waiting = (summary.agents || []).filter(a => (a.reason || "").startsWith("Entrada:")).length;
  const activity = !running ? "El bot está apagado. Enciéndelo para que empiece a vigilar el mercado."
    : summary.gate && summary.gate.ok === false ? `No busca entradas ahora: ${summary.gate.reason}.`
    : signals ? `${signals} par(es) superaron todos los agentes en el último ciclo.`
    : `Vigilando ${summary.agents?.length || 8} pares: ${waiting} esperan una ruptura y el resto no compensan todavía.`;

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try { await fn(); toast.success(okMsg); } catch (e) { toast.error(e.message); } finally { setBusy(null); setDialog(null); }
  };
  const onToggle = () => {
    if (running) return setDialog("stop");
    if (config.mode === "live") return setDialog("start-live");
    act("start", bot.start, "Bot encendido en modo simulado");
  };

  return (
    <div className="space-y-6">
      {/* Cabecera con el único botón importante */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Panel</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{running ? (live ? "Operando con dinero real en Kraken" : "Operando en simulado: ningún euro real en juego") : `Listo para empezar en modo ${config.mode === "live" ? "real" : "simulado"}`}</p>
        </div>
        <Button size="lg" onClick={onToggle} disabled={!!busy} variant={running ? "outline" : "default"} className="min-w-[180px]">
          {busy === "start" || busy === "stop" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Power className="w-4 h-4 mr-2" />}
          {running ? "Apagar bot" : "Encender bot"}
        </Button>
      </div>

      {(failed || stale) && (
        <div className="flex gap-3 rounded-xl border border-chart-3/40 bg-chart-3/10 p-4">
          <AlertTriangle className="w-5 h-5 text-chart-3 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-foreground">{failed ? "El último ciclo ha fallado" : "El bot no ha hecho ciclos en los últimos minutos"}</p>
            <p className="text-muted-foreground text-xs mt-0.5">{failed ? session.last_cycle_error : "Comprueba en Base44 que la automatización «tradingLoop» está activa."}</p>
          </div>
        </div>
      )}

      {/* Números clave */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Capital" value={session ? eur(startCapital + result) : "—"} sub={session ? `empezó con ${eur(startCapital)}` : "sin sesión"} />
        <Stat label="Resultado" value={session ? signedEur(result) : "—"} sub={startCapital ? pct(result / startCapital * 100) : null} tone={result > 0 ? "up" : result < 0 ? "down" : null} />
        <Stat label="Hoy" value={signedEur(today)} tone={today > 0 ? "up" : today < 0 ? "down" : null} />
        <Stat label="Operaciones" value={closed.length} sub={closed.length ? `${wins} ganadas · ${closed.length - wins} perdidas` : "ninguna cerrada aún"} />
      </div>

      {/* Posición abierta */}
      {open.map(trade => (
        <OpenPosition key={trade.id} trade={trade} prices={prices} closing={busy === trade.id} onClose={() => setDialog({ close: trade })} />
      ))}

      {/* Qué está haciendo */}
      <Link to="/oficina" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Building2 className="w-4 h-4 text-primary" /></div>
          <div>
            <p className="text-sm font-medium text-foreground">{activity}</p>
            <p className="text-[11px] text-muted-foreground">{lastTick ? `Último ciclo a las ${new Date(lastTick).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · ver a los agentes trabajando` : "Ver a los agentes trabajando"}</p>
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Curva de capital */}
        <div className="lg:col-span-3 bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Evolución del capital</h3>
          <div className="h-52">
            {closed.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground text-center px-6">Aquí verás cómo evoluciona el capital cuando el bot cierre su primera operación.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve}>
                  <defs><linearGradient id="cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={44} tickFormatter={v => `${v}€`} />
                  <Tooltip formatter={v => eur(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" name="Capital" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#cap)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Últimas operaciones */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Últimas operaciones</h3>
            <Link to="/history" className="text-xs text-primary hover:underline">Ver todas</Link>
          </div>
          {closed.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay operaciones cerradas.</p> : (
            <ul className="divide-y divide-border">
              {[...closed].reverse().slice(0, 6).map(t => (
                <li key={t.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm text-foreground">{fmtPair(t.pair)}</p>
                    <p className="text-[11px] text-muted-foreground">{EXIT_LABELS[t.exit_reason] || "Cerrada"} · {new Date(t.exit_date).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <span className={cn("text-sm font-mono", Number(t.profit_loss) >= 0 ? "text-primary" : "text-destructive")}>{signedEur(t.profit_loss)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Saldo real de Kraken (solo en modo real) */}
      {(live || config.mode === "live") && (
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center gap-2 mb-3"><Wallet className="w-4 h-4 text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Saldo en Kraken</h3></div>
          {kraken.error ? <p className="text-sm text-destructive">{kraken.error}</p> : (
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <span><span className="text-muted-foreground">Total </span><span className="font-mono text-foreground">{eur(kraken.totalEUR)}</span></span>
              <span><span className="text-muted-foreground">Euros disponibles </span><span className="font-mono text-foreground">{eur(kraken.capitalEUR)}</span></span>
              {kraken.portfolio.filter(a => a.asset !== "EUR" && a.sellable === false).length > 0 && (
                <span className="text-muted-foreground text-xs">Restos sin vender (por debajo del mínimo de Kraken): {kraken.portfolio.filter(a => a.asset !== "EUR" && a.sellable === false).map(a => a.asset.replace(/^X(?=[A-Z]{3})/, "")).join(", ")}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmaciones */}
      <AlertDialog open={dialog === "start-live"} onOpenChange={o => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Encender con dinero real?</AlertDialogTitle>
            <AlertDialogDescription>El bot comprará y venderá en tu cuenta de Kraken con tus euros. Cada operación lleva un stop-loss real y el riesgo está limitado a {eur(config.max_loss_per_trade_eur)} por operación y {eur(config.max_daily_loss_eur)} al día, pero puedes perder dinero.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => act("start", bot.start, "Bot encendido en modo real")}>Encender en real</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "stop"} onOpenChange={o => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Apagar el bot?</AlertDialogTitle>
            <AlertDialogDescription>{open.length ? `Tienes ${open.length} posición abierta. Puedes cerrarla ahora o dejarla abierta${live ? " con su stop-loss en Kraken" : ""}.` : "No buscará más entradas hasta que lo vuelvas a encender."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {open.length > 0 && <Button variant="outline" onClick={() => act("stop", () => bot.stop(false), "Bot apagado; la posición sigue abierta")}>Apagar y mantener</Button>}
            <AlertDialogAction onClick={() => act("stop", () => bot.stop(open.length > 0), "Bot apagado")}>{open.length ? "Apagar y cerrar posición" : "Apagar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!dialog?.close} onOpenChange={o => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar {dialog?.close ? fmtPair(dialog.close.pair) : ""} ahora?</AlertDialogTitle>
            <AlertDialogDescription>Se venderá a precio de mercado{live ? " en Kraken" : ""}, sin esperar al objetivo ni al stop.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const t = dialog.close; act(t.id, () => bot.closeTrade(t.id), "Posición cerrada"); }}>Cerrar posición</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
