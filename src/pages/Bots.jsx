import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import BotCard from "../components/BotCard";
import useKrakenData from "../hooks/useKrakenData";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, Power, RefreshCw, ShieldCheck, Square, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Bots() {
  const queryClient = useQueryClient();
  const [runningAction, setRunningAction] = useState(false);
  const [liveResult, setLiveResult] = useState(null);
  const { data: bots = [], isLoading } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list(), refetchInterval: 15000 });
  const { data: sessions = [] } = useQuery({ queryKey: ["botSessionsLive"], queryFn: () => base44.entities.BotSession.filter({ active: true }), refetchInterval: 15000 });
  const { data: openTrades = [] } = useQuery({ queryKey: ["openLiveTrades"], queryFn: () => base44.entities.Trade.filter({ mode: "live", status: "open" }, "-created_date", 20), refetchInterval: 10000 });
  const { data: liveEnv } = useQuery({ queryKey: ["liveEnvStatus"], queryFn: async () => (await base44.functions.invoke("tradingTick", { validateOnly: true })).data, refetchInterval: 30000 });
  const { totalUSD, trades: krakenTrades } = useKrakenData({ intervalMs: 60000 });

  const activeLiveSession = sessions.find(session => session.mode === "live");
  const liveBots = bots.filter(bot => bot.trading_mode === "live" && bot.live_enabled === true);
  const lastTickAt = activeLiveSession?.last_execution_at || activeLiveSession?.last_tick_at || activeLiveSession?.started_at;
  const intervalMinutes = Number(liveEnv?.intervalMinutes || 1);
  const cronStale = activeLiveSession && (!lastTickAt || Date.now() - new Date(lastTickAt).getTime() > Math.max(intervalMinutes * 2, 2) * 60000);
  const totalRealPnl = openTrades.reduce((sum, trade) => sum + Number(trade.profit_loss || 0), 0);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["bots"] });
    queryClient.invalidateQueries({ queryKey: ["botSessionsLive"] });
    queryClient.invalidateQueries({ queryKey: ["openLiveTrades"] });
    queryClient.invalidateQueries({ queryKey: ["liveEnvStatus"] });
  };

  const runAction = async (label, fn) => {
    setRunningAction(true);
    setLiveResult(null);
    try {
      const response = await fn();
      setLiveResult(response.data || response);
      refreshAll();
      toast.success(label);
    } catch (error) {
      const message = error?.response?.data?.error || error.message;
      setLiveResult({ error: message });
      toast.error(message);
    } finally {
      setRunningAction(false);
    }
  };

  const handleValidate = () => runAction("Entorno LIVE validado", () => base44.functions.invoke("tradingTick", { validateOnly: true }));

  const handleStartLive = () => {
    const confirmed = window.confirm("Confirmo que quiero activar trading real en Kraken con capital bajo y sin retiros");
    if (!confirmed) return;
    runAction("Bots LIVE activados", () => base44.functions.invoke("startLiveBots", {}));
  };

  const handleStopLive = () => runAction("Bots LIVE detenidos", () => base44.functions.invoke("stopLiveBots", { closeOpenTrades: false }));
  const handleCloseOpenTrades = () => runAction("Cierre de operaciones solicitado", () => base44.functions.invoke("tradingTick", { forceClose: true }));
  const handleRunCycle = () => runAction("Ciclo LIVE ejecutado", () => base44.functions.invoke("tradingLoop", { autoMode: true }));

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Control de Bots LIVE</h2>
          <p className="text-sm text-muted-foreground mt-1">Trading real continuo con Kraken Spot, capital bajo y gestión automática por tradingTick.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button disabled={runningAction} onClick={handleValidate} variant="outline" className="gap-2"><ShieldCheck className="w-4 h-4" />Validar entorno LIVE</Button>
          <Button disabled={runningAction} onClick={handleStartLive} className="gap-2 bg-destructive hover:bg-destructive/90"><Power className="w-4 h-4" />Activar Bots LIVE</Button>
          <Button disabled={runningAction} onClick={handleRunCycle} variant="outline" className="gap-2"><RefreshCw className={cn("w-4 h-4", runningAction && "animate-spin")} />Ejecutar ciclo ahora</Button>
          <Button disabled={runningAction} onClick={handleCloseOpenTrades} variant="outline" className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10"><XCircle className="w-4 h-4" />Cerrar operaciones abiertas</Button>
          <Button disabled={runningAction} onClick={handleStopLive} variant="outline" className="gap-2"><Square className="w-4 h-4" />Detener Bots LIVE</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Entorno LIVE</span>
          <div className="flex items-center gap-2 mt-2">
            <div className={cn("w-2 h-2 rounded-full", liveEnv?.ok ? "bg-primary animate-pulse" : "bg-destructive")} />
            <span className={cn("text-sm font-semibold", liveEnv?.ok ? "text-primary" : "text-destructive")}>{liveEnv?.ok ? "Validado" : "Bloqueado"}</span>
          </div>
          {!liveEnv?.ok && <p className="text-[11px] text-muted-foreground mt-2">Revisa variables LIVE antes de operar.</p>}
        </div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground uppercase tracking-wider">Sesión activa</span><p className="text-xl font-mono font-bold text-foreground mt-1">{activeLiveSession ? "LIVE" : "—"}</p><p className="text-[11px] text-muted-foreground">Último tick: {lastTickAt ? new Date(lastTickAt).toLocaleTimeString("es-ES") : "—"}</p>{cronStale && <p className="text-[11px] text-chart-3 mt-1">Sin cron: pulsa Ejecutar ciclo ahora</p>}</div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground uppercase tracking-wider">Bots LIVE</span><p className="text-xl font-mono font-bold text-primary mt-1">{liveBots.length}<span className="text-muted-foreground text-sm">/{bots.length}</span></p></div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground uppercase tracking-wider">Operaciones abiertas</span><p className="text-xl font-mono font-bold text-foreground mt-1">{openTrades.length}</p><p className={cn("text-[11px]", totalRealPnl >= 0 ? "text-profit" : "text-loss")}>PnL registrado: {totalRealPnl.toFixed(6)}</p></div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">Estado automático</h3></div>
        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-muted/50 rounded-lg p-3"><span className="text-muted-foreground">Scheduler Base44</span><p className={cn("font-semibold mt-1", cronStale ? "text-chart-3" : "text-foreground")}>{cronStale ? "Sin cron: pulsa Ejecutar ciclo ahora" : `tradingLoop cada ${liveEnv?.intervalMinutes || 1} min`}</p></div>
          <div className="bg-muted/50 rounded-lg p-3"><span className="text-muted-foreground">Máx. por orden</span><p className="font-semibold text-foreground mt-1">{liveEnv?.maxQuote || 10} USD/EUR</p></div>
          <div className="bg-muted/50 rounded-lg p-3"><span className="text-muted-foreground">Kraken</span><p className="font-semibold text-foreground mt-1">Spot · sin leverage · sin margin · sin futures</p></div>
        </div>
      </div>

      {liveResult && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Resultado LIVE</h3>
          {liveResult.error ? <p className="text-sm text-destructive">{liveResult.error}</p> : <pre className="text-xs bg-muted/40 border border-border rounded-lg p-3 overflow-auto max-h-80">{JSON.stringify(liveResult, null, 2)}</pre>}
        </div>
      )}

      {openTrades.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Operaciones LIVE abiertas</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {openTrades.map(trade => <div key={trade.id} className="rounded-lg border border-border bg-muted/30 p-3 text-xs"><div className="flex justify-between"><span className="font-semibold text-foreground">{trade.bot_name}</span><span className="font-mono">{trade.pair}</span></div><div className="grid grid-cols-3 gap-2 mt-2 text-muted-foreground"><span>Entrada: {trade.entry_price}</span><span>Vol: {Number(trade.amount || 0).toFixed(8)}</span><span>Orden: {trade.exchange_order_id || "—"}</span></div></div>)}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {bots.map(bot => <BotCard key={bot.id} bot={bot} totalKrakenUSD={totalUSD} krakenTrades={krakenTrades} />)}
      </div>

      {bots.length === 0 && <div className="text-center py-16 bg-card rounded-xl border border-border"><p className="text-muted-foreground">Aún no hay bots configurados</p></div>}

      <div className="flex items-start gap-2 bg-chart-3/10 border border-chart-3/20 rounded-xl p-4">
        <AlertTriangle className="w-4 h-4 text-chart-3 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-chart-3 leading-relaxed">LIVE opera con dinero real. Los límites activos bloquean órdenes mayores a 25, múltiples trades por bot/par, spread alto, capital insuficiente y pérdidas consecutivas.</p>
      </div>
    </div>
  );
}