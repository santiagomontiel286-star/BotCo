import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import BotCard from "../components/BotCard";
import useKrakenData from "../hooks/useKrakenData";
import { toast } from "sonner";

export default function Bots() {
  const queryClient = useQueryClient();
  const [liveResult, setLiveResult] = useState(null);
  const [runningLiveTest, setRunningLiveTest] = useState(false);
  const { data: bots = [], isLoading } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list() });
  const { totalUSD, trades: krakenTrades } = useKrakenData({ intervalMs: 60000 });

  const updateBot = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Bot.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bots"] }),
  });

  const handleStart = (bot) => {
    if (bot.trading_mode === "live") {
      const confirmed = window.confirm("Vas a activar un bot en LIVE. Solo operará si KRAKEN_LIVE_TRADING=true y respeta MAX_ORDER_USD. ¿Confirmas?");
      if (!confirmed) return;
      updateBot.mutate({ id: bot.id, data: { status: "active", live_enabled: true } });
      toast.warning("Bot LIVE activado con confirmación");
      return;
    }
    updateBot.mutate({ id: bot.id, data: { status: "active", trading_mode: "demo", live_enabled: false } });
    toast.success("Bot DEMO iniciado");
  };

  const handlePause = (id) => { updateBot.mutate({ id, data: { status: "paused" } }); toast.info("Bot pausado"); };
  const handleStop  = (id) => { updateBot.mutate({ id, data: { status: "stopped", live_enabled: false } }); toast.error("Bot detenido"); };

  const handleModeChange = (bot, trading_mode) => {
    updateBot.mutate({ id: bot.id, data: { trading_mode, live_enabled: false } });
    toast.info(trading_mode === "demo" ? "Modo DEMO seleccionado" : "Modo LIVE seleccionado; requiere confirmación al iniciar");
  };

  const handleTradingTick = async () => {
    const response = await base44.functions.invoke("tradingTick", {});
    queryClient.invalidateQueries({ queryKey: ["bots"] });
    toast.success(`Ciclo ejecutado: ${response.data.results?.length || 0} resultados`);
  };

  const ensureLiveBot = async () => {
    const current = bots.find(bot => bot.status === "active") || bots[0];
    if (!current) throw new Error("No hay bots configurados para activar");
    await base44.entities.Bot.update(current.id, {
      status: "active",
      trading_mode: "live",
      live_enabled: true,
      strategy: "first_live_trade",
      max_order_usd: 10,
      pairs: ["XBTUSD"],
      last_error: "",
    });
    return current;
  };

  const handleFirstLiveTrade = async () => {
    const confirmed = window.confirm("Confirmo que quiero ejecutar una operación REAL en Kraken con capital bajo");
    if (!confirmed) return;
    setRunningLiveTest(true);
    setLiveResult(null);
    try {
      await ensureLiveBot();
      const response = await base44.functions.invoke("tradingTick", { firstLiveTrade: true });
      setLiveResult(response.data);
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success("Operación REAL enviada a Kraken");
    } catch (error) {
      const message = error?.response?.data?.error || error.message;
      setLiveResult({ error: message });
      toast.error(message);
    } finally {
      setRunningLiveTest(false);
    }
  };

  const handleForceCloseLiveTrade = async () => {
    const confirmed = window.confirm("¿Cerrar ahora cualquier operación REAL abierta en Kraken con orden market contraria?");
    if (!confirmed) return;
    setRunningLiveTest(true);
    setLiveResult(null);
    try {
      const response = await base44.functions.invoke("tradingTick", { forceClose: true });
      setLiveResult(response.data);
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success("Cierre REAL solicitado");
    } catch (error) {
      const message = error?.response?.data?.error || error.message;
      setLiveResult({ error: message });
      toast.error(message);
    } finally {
      setRunningLiveTest(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Control de Bots</h2>
          <p className="text-sm text-muted-foreground mt-1">Modo por defecto DEMO. LIVE requiere confirmación y variables de entorno.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleTradingTick} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
            Ejecutar ciclo trading
          </button>
          <button disabled={runningLiveTest} onClick={handleFirstLiveTrade} className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50">
            Ejecutar primera operación REAL hoy
          </button>
          <button disabled={runningLiveTest} onClick={handleForceCloseLiveTrade} className="px-4 py-2 rounded-lg border border-destructive/50 text-destructive text-sm font-semibold hover:bg-destructive/10 transition-colors disabled:opacity-50">
            Cerrar operación REAL ahora
          </button>
        </div>
      </div>

      {liveResult && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Resultado operación REAL</h3>
          {liveResult.error ? (
            <p className="text-sm text-destructive">{liveResult.error}</p>
          ) : (
            <div className="space-y-2 text-xs">
              {(liveResult.results || []).map((result, index) => (
                <div key={index} className="rounded-lg bg-muted/40 border border-border p-3 grid sm:grid-cols-5 gap-2">
                  <span><strong>Acción:</strong> {result.action}</span>
                  <span><strong>Par:</strong> {result.pair}</span>
                  <span><strong>Precio:</strong> {result.entryPrice || result.exitPrice || result.price || "—"}</span>
                  <span><strong>Volumen:</strong> {result.volume || "—"}</span>
                  <span><strong>Orden:</strong> {result.exchangeOrderId || result.closeOrderId || "—"}</span>
                  {result.error && <span className="sm:col-span-5 text-destructive"><strong>Error:</strong> {result.error}</span>}
                  {result.pnl != null && <span className="sm:col-span-5"><strong>PnL:</strong> {result.pnl.toFixed(6)} ({result.pnlPercent?.toFixed?.(4)}%)</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {bots.map(bot => (
          <BotCard key={bot.id} bot={bot} onStart={handleStart} onPause={handlePause} onStop={handleStop} onModeChange={handleModeChange} totalKrakenUSD={totalUSD} krakenTrades={krakenTrades} />
        ))}
      </div>

      {bots.length === 0 && (
        <div className="text-center py-16 bg-card rounded-xl border border-border">
          <p className="text-muted-foreground">Aún no hay bots configurados</p>
          <p className="text-xs text-muted-foreground mt-1">Los bots se crearán automáticamente al iniciar</p>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Reglas de Riesgo Globales</h3>
        <div className="grid sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3 rounded-lg bg-muted/50"><span className="text-muted-foreground">Primera prueba LIVE</span><p className="font-mono font-bold text-chart-3 text-lg mt-1">$10 máx.</p></div>
          <div className="p-3 rounded-lg bg-muted/50"><span className="text-muted-foreground">Sin leverage</span><p className="font-mono font-bold text-foreground text-lg mt-1">Spot only</p></div>
          <div className="p-3 rounded-lg bg-muted/50"><span className="text-muted-foreground">Cierre automático</span><p className="font-mono font-bold text-destructive text-lg mt-1">10 min</p></div>
        </div>
      </div>
    </div>
  );
}