import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useBot } from "@/hooks/useBot";
import { cn } from "@/lib/utils";
import {
  Radar, Timer, Target, Hourglass, Calculator, ShieldCheck, Eye,
  Building2, Power, Coffee, CheckCircle2, XCircle, Loader2, Radio
} from "lucide-react";

// Cada agente de la cadena DayTrader, en el orden en que pasa un par por la oficina.
// `prefix` es como tradingLoop etiqueta el rechazo de ese agente en el informe del ciclo.
const AGENTS = [
  { key: "monitor", name: "Monitor de mercado", role: "Vigila si el par está operativo en Kraken y si se mueve de forma anómala", prefix: "Monitor:", icon: Radar, color: "hsl(var(--chart-1))" },
  { key: "entry", name: "Temporizador de entrada", role: "Espera a que una vela cerrada rompa el rango de apertura", prefix: "Entrada:", icon: Timer, color: "hsl(var(--chart-2))" },
  { key: "exit", name: "Planificador de salida", role: "Fija stop y objetivo antes de comprar y mira las comisiones", prefix: "Salida:", icon: Target, color: "hsl(var(--chart-3))" },
  { key: "tm", name: "Máquina del Tiempo", role: "Simula la operación 10.000 veces con 30 días reales", prefix: "Máquina del Tiempo:", icon: Hourglass, color: "hsl(var(--chart-4))" },
  { key: "budget", name: "Gestor de presupuesto", role: "Calcula cuánto comprar para no pasar de la pérdida máxima", prefix: "Presupuesto:", icon: Calculator, color: "hsl(var(--chart-5))" },
];

function parseJson(value) { try { return typeof value === "string" ? JSON.parse(value || "{}") : (value || {}); } catch { return {}; } }
function stripPrefix(reason = "", prefix = "") { return reason.startsWith(prefix) ? reason.slice(prefix.length).trim() : reason; }
function fmtPair(pair = "") { const p = String(pair).toUpperCase(); if (p.includes("/")) return p; const base = p.replace(/(EUR|USD)$/, ""); return `${base === "XBT" ? "BTC" : base}/${p.slice(base.length) || "EUR"}`; }
function hhmm(iso) { return iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"; }

// En qué mesa se quedó cada par: 0..4 = rechazado por ese agente, 5 = superó toda la cadena
function stageOf(row) {
  if (row.ok) return AGENTS.length;
  const idx = AGENTS.findIndex(agent => (row.reason || "").startsWith(agent.prefix));
  return idx >= 0 ? idx : -1; // -1: no entró en la cadena (por ejemplo, ya hay trade abierto)
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}

function StatusLed({ state }) {
  const styles = {
    working: "bg-chart-2 animate-pulse",
    approved: "bg-primary",
    rejected: "bg-destructive",
    idle: "bg-muted-foreground/40",
  };
  return <span className={cn("inline-block w-2.5 h-2.5 rounded-full", styles[state] || styles.idle)} />;
}

const STATE_LABEL = { working: "Trabajando", approved: "Ha aprobado", rejected: "Ha descartado", idle: "En espera" };

function Desk({ agent, stats, working }) {
  const Icon = agent.icon;
  const state = working ? "working" : stats.reached === 0 ? "idle" : stats.passed > 0 ? "approved" : "rejected";
  return (
    <div className="relative bg-card rounded-xl border border-border p-4 flex flex-col gap-3 overflow-hidden">
      {/* La "persona" del agente y su estado */}
      <div className="flex items-center gap-3">
        <div className={cn("w-11 h-11 rounded-full flex items-center justify-center shrink-0 border", working && "office-bob")}
          style={{ backgroundColor: `color-mix(in srgb, ${agent.color} 18%, transparent)`, borderColor: `color-mix(in srgb, ${agent.color} 45%, transparent)` }}>
          <Icon className="w-5 h-5" style={{ color: agent.color }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">{agent.name}</p>
          <p className="text-[11px] text-muted-foreground leading-snug">{agent.role}</p>
        </div>
      </div>

      {/* El monitor de su mesa */}
      <div className="rounded-lg bg-background/70 border border-border p-3 font-mono text-[11px] leading-relaxed min-h-[112px]">
        <div className="flex items-center justify-between mb-2 text-muted-foreground">
          <span className="flex items-center gap-1.5"><StatusLed state={state} />{STATE_LABEL[state]}</span>
          <span>{stats.passed}/{stats.reached} pasan</span>
        </div>
        {working ? (
          <p className="text-foreground">Revisando pares<span className="office-dots" /></p>
        ) : stats.items.length === 0 ? (
          <p className="text-muted-foreground">Ningún par ha llegado a esta mesa en el último ciclo.</p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {stats.items.map(item => (
              <li key={item.pair} className="flex gap-1.5">
                {item.passed ? <CheckCircle2 className="w-3 h-3 mt-0.5 text-primary shrink-0" /> : <XCircle className="w-3 h-3 mt-0.5 text-destructive shrink-0" />}
                <span><span className="text-foreground">{item.pair}</span> <span className="text-muted-foreground">{item.text}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Escritorio */}
      <div className="h-1.5 -mx-4 -mb-4 mt-auto" style={{ backgroundColor: `color-mix(in srgb, ${agent.color} 35%, transparent)` }} />
    </div>
  );
}

function ExecutorDesk({ execution, working }) {
  const opened = execution.filter(e => e.action === "opened");
  const rejected = execution.filter(e => e.action === "signal_rejected");
  const state = working ? "working" : opened.length ? "approved" : rejected.length ? "rejected" : "idle";
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className={cn("w-11 h-11 rounded-full flex items-center justify-center border bg-primary/15 border-primary/40", working && "office-bob")}>
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground leading-tight">Riesgo y Ejecutor</p>
          <p className="text-[11px] text-muted-foreground">Última puerta: límites del día, compra y stop real en Kraken</p>
        </div>
      </div>
      <div className="rounded-lg bg-background/70 border border-border p-3 font-mono text-[11px] leading-relaxed min-h-[112px]">
        <div className="flex items-center gap-1.5 mb-2 text-muted-foreground"><StatusLed state={state} />{STATE_LABEL[state]}</div>
        {opened.length === 0 && rejected.length === 0 && <p className="text-muted-foreground">Sin señales que ejecutar. Ninguna compra en este ciclo.</p>}
        {opened.map((e, i) => <p key={`o${i}`} className="text-primary">✔ Compra {fmtPair(e.pair)} a {e.price} · stop {e.stopPrice}</p>)}
        {rejected.map((e, i) => <p key={`r${i}`}><span className="text-destructive">✖ {fmtPair(e.pair)}</span> <span className="text-muted-foreground">{e.reason}</span></p>)}
      </div>
    </div>
  );
}

function WatchmanDesk({ stopChecks, execution }) {
  const monitoring = execution.filter(e => e.action === "monitoring");
  const closed = execution.filter(e => ["closed", "closed_no_stop"].includes(e.action));
  const errors = execution.filter(e => e.action === "error");
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full flex items-center justify-center border bg-secondary border-border">
          <Eye className="w-5 h-5 text-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground leading-tight">Vigilante de posiciones</p>
          <p className="text-[11px] text-muted-foreground">Comprueba que cada posición tiene su stop en Kraken y cierra en objetivo o tiempo</p>
        </div>
      </div>
      <div className="rounded-lg bg-background/70 border border-border p-3 font-mono text-[11px] leading-relaxed min-h-[112px]">
        {stopChecks.length === 0 && monitoring.length === 0 && closed.length === 0 && errors.length === 0 && <p className="text-muted-foreground">No hay posiciones abiertas que vigilar.</p>}
        {monitoring.length === 0 && stopChecks.map((c, i) => (
          <p key={`s${i}`} className={c.ok ? "text-foreground" : "text-destructive"}>
            {c.ok ? "🛡" : "⚠"} {c.pair}: {c.closedByStop ? "el stop saltó en Kraken" : c.recreated ? "stop recolocado" : c.ok ? "stop activo en Kraken" : c.reason}
          </p>
        ))}
        {monitoring.map((m, i) => <p key={`m${i}`} className="text-muted-foreground">{m.pair} {typeof m.pnlPercent === "number" ? `${m.pnlPercent >= 0 ? "+" : ""}${m.pnlPercent.toFixed(2)} %` : ""} · {m.reason}</p>)}
        {errors.map((e, i) => <p key={`e${i}`} className="text-destructive">⚠ {e.pair}: {e.reason}</p>)}
        {closed.map((c, i) => <p key={`c${i}`} className={Number(c.pnl) >= 0 ? "text-primary" : "text-destructive"}>Cerrada {c.pair} · {Number(c.pnl || 0).toFixed(4)} €</p>)}
      </div>
    </div>
  );
}

export default function Office() {
  const now = useNow();
  const { session: lastSession, running, config, mode } = useBot();
  const { data: alerts = [] } = useQuery({
    queryKey: ["officeAlerts"],
    queryFn: () => base44.entities.Alert.list("-created_date", 12),
    refetchInterval: 15000,
  });

  const session = running ? lastSession : null;
  const risk = config;
  const summary = parseJson(session?.last_cycle_summary);
  const agentsReport = Array.isArray(summary.agents) ? summary.agents : [];
  const execution = Array.isArray(summary.execution) ? summary.execution : [];
  const stopChecks = Array.isArray(summary.stopChecks) ? summary.stopChecks : [];
  const working = session?.last_cycle_status === "running";
  const killSwitch = !!risk.kill_switch;

  const lastTick = session?.last_tick_at;
  const nextCycleMs = lastTick ? new Date(lastTick).getTime() + 5 * 60 * 1000 - now : null;
  const nextLabel = nextCycleMs == null ? "—" : nextCycleMs <= 0 ? "en cualquier momento" : `${Math.floor(nextCycleMs / 60000)}:${String(Math.floor((nextCycleMs % 60000) / 1000)).padStart(2, "0")}`;

  const deskStats = useMemo(() => AGENTS.map((agent, k) => {
    const items = [];
    let reached = 0; let passed = 0;
    for (const row of agentsReport) {
      const stage = stageOf(row);
      if (stage < k) continue;
      reached += 1;
      const ok = stage > k;
      if (ok) passed += 1;
      items.push({ pair: row.pair, passed: ok, text: ok ? (k === 3 && row.timeMachine ? row.timeMachine : "pasa a la siguiente mesa") : stripPrefix(row.reason, agent.prefix) });
    }
    return { reached, passed, items };
  }), [agentsReport]);

  const outside = agentsReport.filter(row => stageOf(row) === -1);

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes officeBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        .office-bob { animation: officeBob 1.2s ease-in-out infinite; }
        @keyframes officeDots { 0% { content: '' } 33% { content: '.' } 66% { content: '..' } 100% { content: '...' } }
        .office-dots::after { content: ''; animation: officeDots 1.2s steps(1) infinite; }
      `}</style>

      {/* Recepción */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Building2 className="w-6 h-6 text-primary" />Oficina de agentes</h1>
          <p className="text-sm text-muted-foreground mt-1">Cada 5 minutos, cada par pasa por estas mesas en orden. Basta con que un agente diga que no para que el bot no compre.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-mono">
          <span className={cn("px-2.5 py-1 rounded-md border", mode === "live" ? "border-chart-3/40 text-chart-3 bg-chart-3/10" : "border-primary/40 text-primary bg-primary/10")}>
            {mode === "live" ? "Dinero real" : "Simulado"}
          </span>
          <span className={cn("px-2.5 py-1 rounded-md border flex items-center gap-1", killSwitch ? "border-destructive/50 text-destructive bg-destructive/10" : "border-border text-muted-foreground")}>
            <Power className="w-3 h-3" />{killSwitch ? "Freno de emergencia ACTIVO" : "Freno de emergencia apagado"}
          </span>
          <span className="px-2.5 py-1 rounded-md border border-border text-muted-foreground flex items-center gap-1">
            {working ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coffee className="w-3 h-3" />}
            {working ? "Ciclo en curso" : `Último ciclo ${hhmm(lastTick)} · siguiente ${nextLabel}`}
          </span>
        </div>
      </div>

      {!session && (
        <div className="bg-card rounded-xl border border-border p-6 text-sm text-muted-foreground">La oficina está cerrada: enciende el bot en el Panel y los agentes empezarán a trabajar en el siguiente ciclo.</div>
      )}

      {session && summary.gate && summary.gate.ok === false && (
        <div className="bg-card rounded-xl border border-chart-3/40 p-4 text-sm text-muted-foreground">
          Los agentes siguen analizando, pero ahora no se abren operaciones: <span className="text-foreground">{summary.gate.reason}</span>.
        </div>
      )}

      {/* Las mesas */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((agent, k) => <Desk key={agent.key} agent={agent} stats={deskStats[k]} working={working} />)}
        <ExecutorDesk execution={execution} working={working} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* El pasillo: hasta dónde llegó cada par */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Recorrido de cada par en el último ciclo</h3>
          {agentsReport.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aún no hay informe de agentes. Aparecerá tras el próximo ciclo con el motor DayTrader.</p>
          ) : (
            <div className="space-y-2">
              {agentsReport.map(row => {
                const stage = stageOf(row);
                return (
                  <div key={row.pair} className="flex items-center gap-3">
                    <span className="w-20 text-xs font-mono text-foreground shrink-0">{row.pair}</span>
                    <div className="flex items-center gap-1 flex-1">
                      {AGENTS.map((agent, k) => {
                        const Icon = agent.icon;
                        const reached = stage >= k;
                        const stoppedHere = stage === k && !row.ok;
                        return (
                          <div key={agent.key} title={agent.name}
                            className={cn("h-7 flex-1 rounded-md flex items-center justify-center border transition-colors",
                              stoppedHere ? "border-destructive/60 bg-destructive/15" : reached ? "border-primary/40 bg-primary/10" : "border-border bg-background/40 opacity-40")}>
                            <Icon className={cn("w-3.5 h-3.5", stoppedHere ? "text-destructive" : reached ? "text-primary" : "text-muted-foreground")} />
                          </div>
                        );
                      })}
                      <div className={cn("h-7 w-16 rounded-md flex items-center justify-center text-[10px] font-mono border shrink-0",
                        row.ok ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground")}>
                        {row.ok ? "SEÑAL" : stage === -1 ? "fuera" : "parado"}
                      </div>
                    </div>
                  </div>
                );
              })}
              {outside.length > 0 && <p className="text-[11px] text-muted-foreground pt-1">«fuera»: {outside.map(r => `${r.pair} (${r.reason})`).join(" · ")}</p>}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <WatchmanDesk stopChecks={stopChecks} execution={execution} />
          {/* Radio de la oficina */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Radio className="w-4 h-4 text-primary" />Radio de la oficina</h3>
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {alerts.length === 0 && <li className="text-xs text-muted-foreground">Sin avisos recientes.</li>}
              {alerts.map(alert => (
                <li key={alert.id} className="text-xs">
                  <span className="font-mono text-muted-foreground">{hhmm(alert.created_date)}</span>{" "}
                  <span className={cn("font-medium", alert.severity === "critical" ? "text-destructive" : alert.severity === "success" ? "text-primary" : "text-foreground")}>{alert.title}</span>
                  <p className="text-muted-foreground line-clamp-2">{alert.message}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
