import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { X, TrendingUp, TrendingDown, Clock, DollarSign, Target, BarChart2, CheckCircle, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const fmtPct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const fmtDuration = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h > 0 && `${h}h`, m > 0 && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
};

const BOTS = [
  { id: "trend", name: "Trend Follower", pct: 35 },
  { id: "mean",  name: "Mean Reversion", pct: 25 },
  { id: "ai",    name: "AI Sentiment",   pct: 25 },
  { id: "risk",  name: "Risk Guardian",  pct: 15 },
];

export default function SessionReportModal({ sessionData, onClose }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { capital, pnl, trades, elapsedSeconds, startedAt } = sessionData;
  const pnlPct = capital > 0 ? (pnl / capital) * 100 : 0;
  const isPositive = pnl >= 0;

  // Simulate per-bot breakdown (proportional)
  const botBreakdown = BOTS.map(b => ({
    ...b,
    capital: (capital * b.pct) / 100,
    pnl: (pnl * b.pct) / 100,
    trades: Math.round(trades * b.pct / 100),
  }));

  const botBreakdownStr = JSON.stringify(botBreakdown);

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.SessionReport.create({
      started_at: startedAt || new Date(Date.now() - elapsedSeconds * 1000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: elapsedSeconds,
      assigned_capital: capital,
      pnl: parseFloat(pnl.toFixed(4)),
      pnl_pct: parseFloat(pnlPct.toFixed(4)),
      trades_count: trades,
      bot_breakdown: botBreakdownStr,
    });
    setSaving(false);
    setSaved(true);
    toast.success("Sesión archivada correctamente");
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className={cn("p-5 border-b border-border", isPositive ? "bg-primary/5" : "bg-destructive/5")}>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-lg font-bold text-foreground">Resumen de Sesión</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Sesión finalizada · {fmtDuration(elapsedSeconds)}</p>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Hero metric */}
          <div className="flex items-center justify-between bg-muted/40 rounded-xl p-4 border border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-1">P&amp;L Total de la sesión</p>
              <p className={cn("text-3xl font-mono font-bold", isPositive ? "text-primary" : "text-destructive")}>
                {isPositive ? "+" : ""}{fmt(pnl)}
              </p>
              <p className={cn("text-sm font-semibold mt-0.5", isPositive ? "text-primary" : "text-destructive")}>
                {fmtPct(pnlPct)} sobre capital asignado
              </p>
            </div>
            {isPositive ? <TrendingUp className="w-10 h-10 text-primary/30" /> : <TrendingDown className="w-10 h-10 text-destructive/30" />}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Capital asignado</span>
              </div>
              <p className="text-sm font-mono font-bold text-foreground">{fmt(capital)}</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Duración</span>
              </div>
              <p className="text-sm font-mono font-bold text-foreground">{fmtDuration(elapsedSeconds)}</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Operaciones</span>
              </div>
              <p className="text-sm font-mono font-bold text-foreground">{trades}</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1">
                <Target className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Capital final est.</span>
              </div>
              <p className={cn("text-sm font-mono font-bold", isPositive ? "text-primary" : "text-destructive")}>{fmt(capital + pnl)}</p>
            </div>
          </div>

          {/* Bot breakdown */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Desglose por bot</p>
            <div className="space-y-2">
              {botBreakdown.map(b => (
                <div key={b.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5 border border-border/30">
                  <div>
                    <span className="text-xs font-semibold text-foreground">{b.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{b.pct}% · {b.trades} ops · {fmt(b.capital)}</span>
                  </div>
                  <span className={cn("text-xs font-mono font-bold", b.pnl >= 0 ? "text-primary" : "text-destructive")}>
                    {b.pnl >= 0 ? "+" : ""}{fmt(b.pnl)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-5 pt-0 flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cerrar</Button>
          {!saved ? (
            <Button onClick={handleSave} disabled={saving} className="flex-[2] gap-2">
              <Archive className="w-4 h-4" />
              {saving ? "Archivando..." : "Archivar sesión"}
            </Button>
          ) : (
            <Button disabled className="flex-[2] gap-2 bg-primary/20 text-primary border border-primary/30">
              <CheckCircle className="w-4 h-4" />
              Sesión archivada
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}