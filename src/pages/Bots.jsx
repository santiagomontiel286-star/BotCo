import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import BotCard from "../components/BotCard";
import BotActivationPanel from "../components/BotActivationPanel";
import useKrakenData from "../hooks/useKrakenData";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Bots() {
  const [activeTab, setActiveTab] = useState("bots");
  const queryClient = useQueryClient();
  const { data: bots = [], isLoading } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list() });
  const { totalUSD, trades: krakenTrades } = useKrakenData({ intervalMs: 60000 });

  const updateBot = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Bot.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bots"] }),
  });

  const handleStart = (id) => { updateBot.mutate({ id, data: { status: "active" } }); toast.success("Bot iniciado"); };
  const handlePause = (id) => { updateBot.mutate({ id, data: { status: "paused" } }); toast.info("Bot pausado"); };
  const handleStop  = (id) => { updateBot.mutate({ id, data: { status: "stopped" } }); toast.error("Bot detenido"); };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + tabs */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Control de Bots</h2>
          <p className="text-sm text-muted-foreground mt-1">Hasta 6 bots independientes según perfil de riesgo</p>
        </div>
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1 border border-border">
          <button
            onClick={() => setActiveTab("bots")}
            className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-colors",
              activeTab === "bots" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            Bots
          </button>
          <button
            onClick={() => setActiveTab("operar")}
            className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-colors",
              activeTab === "operar" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            Operar
          </button>
        </div>
      </div>

      {/* Tab: Operar */}
      {activeTab === "operar" && <BotActivationPanel />}

      {/* Tab: Bots */}
      {activeTab === "bots" && (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {bots.map(bot => (
              <BotCard key={bot.id} bot={bot} onStart={handleStart} onPause={handlePause} onStop={handleStop} totalKrakenUSD={totalUSD} krakenTrades={krakenTrades} />
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
      )}
    </div>
  );
}