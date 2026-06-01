import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import BotCard from "../components/BotCard";
import useKrakenData from "../hooks/useKrakenData";
import { toast } from "sonner";

export default function Bots() {
  const queryClient = useQueryClient();
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
    const data = trading_mode === "demo" ? { trading_mode, live_enabled: false } : { trading_mode, live_enabled: false };
    updateBot.mutate({ id: bot.id, data });
    toast.info(trading_mode === "demo" ? "Modo DEMO seleccionado" : "Modo LIVE seleccionado; requiere confirmación al iniciar");
  };
  const handleTradingTick = async () => {
    const response = await base44.functions.invoke("tradingTick", {});
    queryClient.invalidateQueries({ queryKey: ["bots"] });
    toast.success(`Ciclo ejecutado: ${response.data.activeBots} bots activos`);
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
        <button onClick={handleTradingTick} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
          Ejecutar ciclo trading
        </button>
      </div>

      <>
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
              <div className="p-3 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Riesgo Máx/Trade</span>
                <p className="font-mono font-bold text-chart-3 text-lg mt-1">0.5%</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Pausa tras Pérdidas</span>
                <p className="font-mono font-bold text-foreground text-lg mt-1">3 consecutivas</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Límite Pérdida Diaria</span>
                <p className="font-mono font-bold text-destructive text-lg mt-1">3%</p>
              </div>
            </div>
          </div>
      </>
    </div>
  );
}