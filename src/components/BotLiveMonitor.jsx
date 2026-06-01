import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Activity, AlertTriangle, Bot, ChevronUp, Eye, EyeOff, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import useKrakenData from "@/hooks/useKrakenData";

const REFRESH_MS = 45000;
const HEALTH_REFRESH_MS = 90000;

function fmtTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function relativeMinutes(value) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes <= 0 ? "ahora" : `hace ${minutes}m`;
}

function signalLabel(text = "") {
  const value = text.toLowerCase();
  if (!text) return "Esperando señal";
  if (value.includes("capital inferior")) return "Capital insuficiente";
  if (value.includes("volumen") || value.includes("mínimo")) return "Volumen bajo";
  if (value.includes("skip") || value.includes("bloqueado")) return "Bloqueado";
  if (value.includes("opened")) return "Operando";
  if (value.includes("closed")) return "Cerrada";
  return text.length > 38 ? `${text.slice(0, 38)}…` : text;
}

function statusDot(status) {
  if (status === "error") return "bg-destructive";
  if (status === "warning") return "bg-chart-3";
  return "bg-primary";
}

function parseRawData(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export default function BotLiveMonitor() {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("botco_monitor_open");
    if (saved !== null) return saved === "true";
    return window.innerWidth >= 1024;
  });
  const { totalUSD, loading: loadingKraken } = useKrakenData({ intervalMs: HEALTH_REFRESH_MS });

  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list(), refetchInterval: REFRESH_MS });
  const { data: trades = [] } = useQuery({ queryKey: ["monitor-trades"], queryFn: () => base44.entities.Trade.list("-created_date", 20), refetchInterval: REFRESH_MS });
  const { data: alerts = [] } = useQuery({ queryKey: ["monitor-alerts"], queryFn: () => base44.entities.Alert.list("-created_date", 10), refetchInterval: REFRESH_MS });
  const { data: signals = [] } = useQuery({ queryKey: ["monitor-signals"], queryFn: () => base44.entities.Signal.list("-created_date", 50), refetchInterval: REFRESH_MS });
  const { data: sessions = [] } = useQuery({ queryKey: ["botSessionsLive"], queryFn: () => base44.entities.BotSession.filter({ active: true }), refetchInterval: REFRESH_MS });
  const { data: health } = useQuery({
    queryKey: ["liveEnvStatus"],
    queryFn: async () => (await base44.functions.invoke("tradingTick", { validateOnly: true })).data,
    refetchInterval: HEALTH_REFRESH_MS,
  });

  const session = sessions.find(item => item.mode === "live") || sessions[0];
  const cycleSummary = parseRawData(session?.last_cycle_summary);
  const lastScannerTick = session?.last_scanner_at || cycleSummary.scannerTick;
  const lastExecutionTick = session?.last_execution_at || session?.last_tick_at || cycleSummary.executionTick;
  const lastTick = lastExecutionTick || session?.started_at;
  const intervalMinutes = Number(health?.intervalMinutes || 1);
  const cronStale = session?.mode === "live" && (!lastExecutionTick || Date.now() - new Date(lastExecutionTick).getTime() > Math.max(intervalMinutes * 2, 2) * 60000);
  const liveBots = bots.filter(bot => bot.trading_mode === "live" && bot.live_enabled === true);
  const activeBots = bots.filter(bot => bot.status === "active");
  const blockedBots = bots.filter(bot => `${bot.last_signal || ""} ${bot.last_error || ""}`.toLowerCase().match(/skip|bloqueado|capital inferior|volumen|mínimo/));
  const openTrades = trades.filter(trade => trade.status === "open" && trade.mode === "live");
  const latestTrade = trades.find(trade => trade.mode === "live");
  const latestSignal = signals[0];
  const latestRaw = parseRawData(latestSignal?.raw_data);
  const scannedPairs = latestRaw.scannedPairs || health?.supportedPairs || [];
  const newSignals = signals.filter(signal => signal.status === "new");
  const rejectedSignals = signals.filter(signal => signal.status === "rejected");
  const executedSignals = signals.filter(signal => signal.status === "executed");
  const bestSignals = [...newSignals].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 4);
  const maxOpenTrades = Number(health?.maxOpenTrades || health?.env?.maxOpenTrades || 3);
  const minReservedQuote = Number(health?.minReservedQuote || health?.env?.minReservedQuote || 2);
  const minCapitalRows = signals.filter(signal => Number(signal.min_required_quote || 0) > 0).slice(0, 5);
  const searchingBots = activeBots.filter(bot => !blockedBots.some(blocked => blocked.id === bot.id));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayPnl = trades
    .filter(trade => new Date(trade.exit_date || trade.updated_date || trade.created_date).getTime() >= today.getTime())
    .reduce((sum, trade) => sum + Number(trade.profit_loss || 0), 0);

  const healthStatus = health?.ok === false || bots.some(bot => bot.last_error) ? "error" : blockedBots.length || cronStale ? "warning" : "ok";
  const modeLabel = liveBots.length ? "LIVE" : "DEMO";

  const events = useMemo(() => {
    const rows = [];
    if (lastTick) rows.push({ date: lastTick, type: "tick ejecutado", tone: cronStale ? "warning" : "ok", text: `Tick ${relativeMinutes(lastTick)}` });
    alerts.forEach(alert => rows.push({ date: alert.created_date, type: alert.title || "evento", tone: alert.severity === "critical" ? "error" : alert.severity === "warning" ? "warning" : "ok", text: alert.message || alert.title }));
    signals.slice(0, 8).forEach(signal => {
      rows.push({ date: signal.updated_date || signal.created_date, type: `señal ${signal.status}`, tone: signal.status === "executed" ? "ok" : signal.status === "rejected" || signal.status === "expired" ? "warning" : "ok", text: `${signal.bot_name} ${signal.side} ${signal.pair} · ${signal.reason || "sin motivo"}` });
    });
    trades.forEach(trade => {
      if (trade.status === "open") rows.push({ date: trade.entry_date || trade.created_date, type: "operación abierta", tone: "ok", text: `${trade.bot_name} ${trade.pair} · ${trade.exchange_order_id || "sin id"}` });
      if (trade.status === "closed") rows.push({ date: trade.exit_date || trade.updated_date, type: "operación cerrada", tone: Number(trade.profit_loss || 0) >= 0 ? "ok" : "warning", text: `${trade.bot_name} PnL ${Number(trade.profit_loss || 0).toFixed(6)}` });
    });
    bots.forEach(bot => {
      if (bot.last_error) rows.push({ date: bot.last_run_at || bot.updated_date, type: "error Kraken", tone: "error", text: `${bot.name}: ${bot.last_error}` });
      else if (bot.last_signal) rows.push({ date: bot.last_run_at || bot.updated_date, type: signalLabel(bot.last_signal), tone: bot.last_signal.toLowerCase().includes("skip") || bot.last_signal.toLowerCase().includes("bloqueado") ? "warning" : "ok", text: `${bot.name}: ${signalLabel(bot.last_signal)}` });
    });
    return rows.filter(item => item.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  }, [alerts, bots, trades, signals, lastTick, cronStale]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    window.localStorage.setItem("botco_monitor_open", String(next));
  };

  return (
    <>
      <button
        onClick={toggleOpen}
        className="fixed right-4 bottom-4 lg:top-[90px] lg:bottom-auto z-40 rounded-full border border-border/60 bg-background/80 backdrop-blur-md p-3 text-foreground shadow-xl hover:bg-muted/80 transition-colors"
        aria-label={open ? "Ocultar monitor" : "Mostrar monitor"}
      >
        {open ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>

      {open && (
        <aside className="fixed right-4 bottom-20 top-auto lg:top-[90px] lg:bottom-auto z-40 w-[calc(100vw-32px)] max-w-[320px] lg:w-[320px] max-h-[72vh] lg:max-h-[calc(100vh-110px)] overflow-hidden rounded-2xl border border-border/60 bg-background/70 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", statusDot(healthStatus))} />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-foreground">Live Ops</p>
                <p className="text-[10px] text-muted-foreground">Monitor de bots</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", liveBots.length ? "bg-destructive/15 text-destructive" : "bg-chart-3/15 text-chart-3")}>{modeLabel}</span>
              <button onClick={toggleOpen} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronUp className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="max-h-[calc(72vh-52px)] lg:max-h-[calc(100vh-162px)] overflow-y-auto p-4 space-y-4">
            <section className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-muted/35 border border-border/40 p-3"><p className="text-muted-foreground">Sistema</p><p className={cn("font-semibold", healthStatus === "error" ? "text-destructive" : healthStatus === "warning" ? "text-chart-3" : "text-primary")}>{cronStale ? "Sin cron" : activeBots.length ? "Operando" : "Detenido"}</p></div>
              <div className="rounded-xl bg-muted/35 border border-border/40 p-3"><p className="text-muted-foreground">Scanner tick</p><p className="font-mono text-foreground">{fmtTime(lastScannerTick)}</p></div>
              <div className="rounded-xl bg-muted/35 border border-border/40 p-3"><p className="text-muted-foreground">Execution tick</p><p className="font-mono text-foreground">{fmtTime(lastExecutionTick)}</p></div>
              <div className="rounded-xl bg-muted/35 border border-border/40 p-3"><p className="text-muted-foreground">Health</p><p className="font-semibold text-foreground">{health?.ok ? "OK" : "Error"}</p></div>
            </section>

            {cronStale && <div className="flex items-start gap-2 rounded-xl border border-chart-3/30 bg-chart-3/10 p-3 text-xs text-chart-3"><AlertTriangle className="w-4 h-4 shrink-0" />Sin cron: pulsa Ejecutar ciclo ahora.</div>}
            {session?.last_error && <div className="rounded-xl border border-border/40 bg-muted/30 p-3 text-xs text-muted-foreground"><span className="text-foreground font-semibold">Último motivo:</span> {session.last_error}</div>}

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground"><Activity className="w-3.5 h-3.5 text-primary" />Resumen</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Metric label="Bots activos" value={activeBots.length} />
                <Metric label="Bloqueados" value={blockedBots.length} tone={blockedBots.length ? "warning" : "default"} />
                <Metric label="Ops abiertas" value={`${openTrades.length}/${maxOpenTrades}`} tone={openTrades.length >= maxOpenTrades ? "warning" : "default"} />
                <Metric label="Capital Kraken" value={loadingKraken ? "…" : `$${Number(totalUSD || 0).toFixed(2)}`} />
                <Metric label="Reserva mín." value={`€${minReservedQuote.toFixed(0)}`} />
                <Metric label="Pares escaneados" value={scannedPairs.length || "—"} />
                <Metric label="PnL día" value={`${dayPnl >= 0 ? "+" : ""}${dayPnl.toFixed(6)}`} tone={dayPnl < 0 ? "error" : "ok"} />
                <Metric label="Señales new" value={newSignals.length} tone={newSignals.length ? "ok" : "default"} />
                <Metric label="Abiertas/cerradas" value={`${Number(cycleSummary.tradesOpened || 0)}/${Number(cycleSummary.tradesClosed || 0)}`} tone={Number(cycleSummary.tradesOpened || cycleSummary.tradesClosed || 0) ? "ok" : "default"} />
                <Metric label="Ejecutadas" value={executedSignals.length} tone={executedSignals.length ? "ok" : "default"} />
                <Metric label="Buscando" value={searchingBots.length} />
              </div>
            </section>

            {bestSignals.length > 0 && (
              <section className="space-y-2">
                <div className="text-xs font-semibold text-foreground">Mejores señales actuales</div>
                {bestSignals.map(signal => (
                  <SignalCard key={signal.id} signal={signal} />
                ))}
              </section>
            )}

            {signals.length > 0 && (
              <section className="space-y-2">
                <div className="text-xs font-semibold text-foreground">Signal Bus</div>
                {signals.slice(0, 5).map(signal => (
                  <div key={signal.id} className="rounded-xl border border-border/45 bg-muted/25 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground truncate">{signal.bot_name}</span>
                      <Badge tone={signal.status === "executed" ? "ok" : signal.status === "rejected" || signal.status === "expired" ? "error" : "default"}>{signal.status}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-primary">{signal.side} · {signal.pair} · score {Number(signal.score || 0).toFixed(0)} · conf {Number(signal.confidence || 0).toFixed(2)}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">mín {Number(signal.min_required_quote || 0).toFixed(2)} · disp {Number(signal.available_quote || 0).toFixed(2)} · spread {Number(signal.spread_pct || 0).toFixed(3)}%</p>
                    <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{signal.reason || "Sin motivo"}</p>
                  </div>
                ))}
              </section>
            )}

            {minCapitalRows.length > 0 && (
              <section className="space-y-2">
                <div className="text-xs font-semibold text-foreground">Capital mínimo por par</div>
                {minCapitalRows.map(signal => (
                  <div key={`min-${signal.id}`} className="flex items-center justify-between rounded-lg bg-muted/25 p-2 text-xs">
                    <span className="font-mono text-foreground">{signal.pair}</span>
                    <span className="text-muted-foreground">mín {Number(signal.min_required_quote || 0).toFixed(2)} · disp {Number(signal.available_quote || 0).toFixed(2)}</span>
                  </div>
                ))}
              </section>
            )}

            {rejectedSignals.length > 0 && (
              <section className="space-y-2">
                <div className="text-xs font-semibold text-foreground">Últimos rechazos</div>
                {rejectedSignals.slice(0, 3).map(signal => (
                  <div key={`rej-${signal.id}`} className="rounded-lg border border-chart-3/20 bg-chart-3/10 p-2 text-xs">
                    <p className="font-mono text-chart-3">{signal.bot_name} · {signal.pair}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{signal.reason || "Sin motivo"}</p>
                  </div>
                ))}
              </section>
            )}

            {openTrades.length > 0 && (
              <section className="space-y-2">
                <div className="text-xs font-semibold text-foreground">Operaciones abiertas</div>
                {openTrades.slice(0, 3).map(trade => <div key={trade.id} className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><div className="flex justify-between"><span className="font-semibold text-foreground">{trade.bot_name}</span><span className="font-mono text-primary">{trade.pair}</span></div><p className="mt-1 text-muted-foreground">Entrada ${Number(trade.entry_price || 0).toLocaleString()} · {relativeMinutes(trade.entry_date || trade.created_date)}</p></div>)}
              </section>
            )}

            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Bot className="w-3.5 h-3.5 text-primary" />Bots</div>
              {bots.map(bot => {
                const signal = signalLabel(bot.last_signal);
                const tone = bot.last_error ? "error" : (bot.last_signal || "").toLowerCase().match(/skip|bloqueado|capital|volumen|mínimo/) ? "warning" : "ok";
                const botTrade = openTrades.find(trade => trade.bot_name === bot.name);
                return (
                  <div key={bot.id} className="rounded-xl border border-border/45 bg-muted/25 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground truncate">{bot.name}</span>
                      <span className={cn("h-2 w-2 rounded-full shrink-0", statusDot(tone))} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge>{bot.status}</Badge><Badge>{bot.trading_mode}</Badge><Badge tone={bot.live_enabled ? "error" : "default"}>{bot.live_enabled ? "live_enabled" : "demo"}</Badge>
                    </div>
                    {bot.last_error ? <p className="mt-2 text-destructive">Error: {bot.last_error}</p> : <p className={cn("mt-2", tone === "warning" ? "text-chart-3" : "text-muted-foreground")}>{signal === "Esperando señal" ? "monitoring" : signal}</p>}
                    {botTrade?.exchange_order_id && <p className="mt-1 font-mono text-[10px] text-primary">Orden {botTrade.exchange_order_id}</p>}
                  </div>
                );
              })}
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Radio className="w-3.5 h-3.5 text-primary" />Eventos</div>
              {events.length === 0 ? <p className="text-xs text-muted-foreground">Sin eventos recientes</p> : events.map((event, index) => (
                <div key={`${event.date}-${index}`} className="flex gap-2 rounded-lg bg-muted/25 p-2 text-xs">
                  <span className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0", statusDot(event.tone))} />
                  <div className="min-w-0"><p className="text-foreground truncate">{event.type}</p><p className="text-[10px] text-muted-foreground truncate">{event.text}</p></div>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtTime(event.date)}</span>
                </div>
              ))}
            </section>
          </div>
        </aside>
      )}
    </>
  );
}

function Metric({ label, value, tone = "default" }) {
  return <div className="rounded-xl border border-border/40 bg-muted/30 p-2.5"><p className="text-[10px] text-muted-foreground">{label}</p><p className={cn("mt-0.5 truncate font-mono text-xs font-bold", tone === "warning" ? "text-chart-3" : tone === "error" ? "text-destructive" : tone === "ok" ? "text-primary" : "text-foreground")}>{value}</p></div>;
}

function SignalCard({ signal }) {
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground truncate">{signal.bot_name}</span>
        <Badge tone="ok">score {Number(signal.score || 0).toFixed(0)}</Badge>
      </div>
      <p className="mt-1 font-mono text-[10px] text-primary">{signal.side} · {signal.pair} · conf {Number(signal.confidence || 0).toFixed(2)}</p>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">mín {Number(signal.min_required_quote || 0).toFixed(2)} · disp {Number(signal.available_quote || 0).toFixed(2)} · orden {Number(signal.order_quote || 0).toFixed(2)}</p>
      <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{signal.reason || "Sin motivo"}</p>
    </div>
  );
}

function Badge({ children, tone = "default" }) {
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", tone === "ok" ? "bg-primary/15 text-primary" : tone === "error" ? "bg-destructive/15 text-destructive" : "bg-background/60 text-muted-foreground border border-border/40")}>{children}</span>;
}