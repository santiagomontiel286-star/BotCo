import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Archive, TrendingUp, TrendingDown, Clock, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n ?? 0);
const fmtPct = (n) => (n >= 0 ? "+" : "") + (n ?? 0).toFixed(2) + "%";
const fmtDuration = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [h > 0 && `${h}h`, m > 0 && `${m}m`, `${s % 60}s`].filter(Boolean).join(" ");
};

export default function SessionReports() {
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["session_reports"],
    queryFn: () => base44.entities.SessionReport.list("-created_date", 50),
  });

  const totalPnl = reports.reduce((s, r) => s + (r.pnl || 0), 0);
  const totalTrades = reports.reduce((s, r) => s + (r.trades_count || 0), 0);
  const profitableSessions = reports.filter(r => r.pnl > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Archivo de Sesiones</h2>
        <p className="text-sm text-muted-foreground mt-1">Historial completo de todas las sesiones de trading</p>
      </div>

      {/* Summary stats */}
      {reports.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">P&amp;L Total histórico</p>
            <p className={cn("text-xl font-mono font-bold", totalPnl >= 0 ? "text-primary" : "text-destructive")}>
              {totalPnl >= 0 ? "+" : ""}{fmt(totalPnl)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">Sesiones totales</p>
            <p className="text-xl font-mono font-bold text-foreground">{reports.length}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">Sesiones rentables</p>
            <p className="text-xl font-mono font-bold text-primary">{profitableSessions}<span className="text-sm text-muted-foreground">/{reports.length}</span></p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">Operaciones totales</p>
            <p className="text-xl font-mono font-bold text-foreground">{totalTrades}</p>
          </div>
        </div>
      )}

      {/* Sessions list */}
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando sesiones...</div>
      )}

      {!isLoading && reports.length === 0 && (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <Archive className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium text-foreground">Sin sesiones archivadas</p>
          <p className="text-xs text-muted-foreground mt-1">Las sesiones se guardan al detener los bots y archivar el resumen.</p>
        </div>
      )}

      <div className="space-y-3">
        {reports.map(r => {
          const isPositive = (r.pnl || 0) >= 0;
          const breakdown = (() => { try { return JSON.parse(r.bot_breakdown || "[]"); } catch { return []; } })();
          return (
            <div key={r.id} className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/20 transition-colors">
              {/* Session header */}
              <div className="flex items-center justify-between p-4 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isPositive ? "bg-primary/10" : "bg-destructive/10")}>
                    {isPositive ? <TrendingUp className="w-4 h-4 text-primary" /> : <TrendingDown className="w-4 h-4 text-destructive" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Sesión · {new Date(r.ended_at || r.created_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.started_at && new Date(r.started_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      {r.ended_at && " → " + new Date(r.ended_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      {r.duration_seconds ? " · " + fmtDuration(r.duration_seconds) : ""}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("text-lg font-mono font-bold", isPositive ? "text-primary" : "text-destructive")}>
                    {isPositive ? "+" : ""}{fmt(r.pnl)}
                  </p>
                  <p className={cn("text-xs font-semibold", isPositive ? "text-primary" : "text-destructive")}>
                    {fmtPct(r.pnl_pct)}
                  </p>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 divide-x divide-border/50 text-center">
                <div className="py-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Capital</p>
                  <p className="text-xs font-mono font-semibold text-foreground">{fmt(r.assigned_capital)}</p>
                </div>
                <div className="py-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Operaciones</p>
                  <p className="text-xs font-mono font-semibold text-foreground">{r.trades_count ?? "—"}</p>
                </div>
                <div className="py-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Capital final</p>
                  <p className={cn("text-xs font-mono font-semibold", isPositive ? "text-primary" : "text-destructive")}>
                    {fmt((r.assigned_capital || 0) + (r.pnl || 0))}
                  </p>
                </div>
              </div>

              {/* Bot breakdown */}
              {breakdown.length > 0 && (
                <div className="px-4 pb-4 pt-2 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Desglose por bot</p>
                  {breakdown.map(b => (
                    <div key={b.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{b.name} <span className="text-foreground font-semibold">{b.pct}%</span></span>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">{b.trades} ops</span>
                        <span className={cn("font-mono font-semibold w-20 text-right", (b.pnl || 0) >= 0 ? "text-primary" : "text-destructive")}>
                          {(b.pnl || 0) >= 0 ? "+" : ""}{fmt(b.pnl)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}