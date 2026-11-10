import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { eur, signedEur, pct, fmtPair, EXIT_LABELS } from "@/hooks/useBot";

const MODES = [{ key: "demo", label: "Simulado" }, { key: "live", label: "Real" }];
const fmtDate = d => (d ? new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const duration = t => { if (!t.exit_date) return "—"; const m = Math.round((new Date(t.exit_date) - new Date(t.entry_date || t.created_date)) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export default function History() {
  const [mode, setMode] = useState("demo");
  const { data: trades = [], isLoading } = useQuery({
    queryKey: ["history", mode],
    queryFn: async () => { const r = await base44.entities.Trade.filter({ mode }, "-created_date", 500); return Array.isArray(r) ? r : r?.items || []; },
  });
  const closed = trades.filter(t => t.status === "closed");
  const total = closed.reduce((s, t) => s + Number(t.profit_loss || 0), 0);
  const fees = closed.reduce((s, t) => s + Number(t.fee || 0) + Number(t.close_fee || 0), 0);
  const wins = closed.filter(t => Number(t.profit_loss) > 0);
  const losses = closed.filter(t => Number(t.profit_loss) <= 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + Number(t.profit_loss), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + Number(t.profit_loss), 0) / losses.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Historial</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Todas las operaciones, con comisiones incluidas en el resultado.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border p-1 bg-card">
          {MODES.map(m => (
            <button key={m.key} onClick={() => setMode(m.key)} className={cn("px-3 py-1.5 text-sm rounded-md", mode === m.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>{m.label}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Resultado total", signedEur(total), total > 0 ? "up" : total < 0 ? "down" : null],
          ["Operaciones", `${closed.length}`, null, `${wins.length} ganadas · ${losses.length} perdidas`],
          ["Ganancia media / pérdida media", `${signedEur(avgWin)} / ${signedEur(avgLoss)}`, null],
          ["Comisiones pagadas", eur(fees), null],
        ].map(([label, value, tone, sub]) => (
          <div key={label} className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("text-lg font-mono font-semibold mt-1", tone === "up" ? "text-primary" : tone === "down" ? "text-destructive" : "text-foreground")}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              {["Fecha", "Par", "Estado", "Entrada", "Salida", "Duración", "Motivo", "Resultado"].map((h, i) => <th key={h} className={cn("px-4 py-3 font-medium", i >= 3 && i !== 6 ? "text-right" : "text-left")}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(t.entry_date || t.created_date)}</td>
                <td className="px-4 py-3 font-medium text-foreground">{fmtPair(t.pair)}</td>
                <td className="px-4 py-3">{t.status === "open" ? <span className="text-chart-2">Abierta</span> : t.status === "closed" ? <span className="text-muted-foreground">Cerrada</span> : <span className="text-muted-foreground">{t.status}</span>}</td>
                <td className="px-4 py-3 text-right font-mono">{t.entry_price ? Number(t.entry_price).toLocaleString("es-ES", { maximumFractionDigits: 6 }) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{t.exit_price ? Number(t.exit_price).toLocaleString("es-ES", { maximumFractionDigits: 6 }) : "—"}</td>
                <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">{duration(t)}</td>
                <td className="px-4 py-3 text-muted-foreground">{EXIT_LABELS[t.exit_reason] || (t.status === "closed" ? "—" : "")}</td>
                <td className={cn("px-4 py-3 text-right font-mono whitespace-nowrap", t.profit_loss == null ? "text-muted-foreground" : Number(t.profit_loss) >= 0 ? "text-primary" : "text-destructive")}>
                  {t.profit_loss == null ? "—" : <>{signedEur(t.profit_loss, 3)}<span className="block text-[10px] text-muted-foreground">{pct(t.profit_loss_percent)}</span></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && trades.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No hay operaciones en modo {mode === "live" ? "real" : "simulado"}.</p>}
      </div>
    </div>
  );
}
