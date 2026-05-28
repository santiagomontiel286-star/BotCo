import { Wallet as WalletIcon, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import useKrakenData from "../hooks/useKrakenData";

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);

export default function WalletPage() {
  const { portfolio, totalUSD, trades: krakenTrades, loading, error, refresh } = useKrakenData({ intervalMs: 60000 });

  const netPnl = krakenTrades.reduce((s, t) => s + (t.net || 0), 0);
  const isPositive = netPnl >= 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center glow-green-sm">
            <WalletIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Wallet</h2>
            <p className="text-sm text-muted-foreground">Portfolio real — Kraken Pro</p>
          </div>
        </div>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Actualizar
        </button>
      </div>

      {/* Balance principal */}
      <div className="bg-card rounded-xl border border-primary/20 p-6 glow-green">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">Balance Total Kraken</span>
        {loading && !totalUSD ? (
          <p className="text-3xl font-mono font-bold text-muted-foreground mt-2 animate-pulse">Cargando...</p>
        ) : error ? (
          <p className="text-sm text-destructive mt-2">{error}</p>
        ) : (
          <>
            <p className="text-3xl font-mono font-bold text-foreground mt-2">{fmt(totalUSD)}</p>
            <div className={cn("flex items-center gap-1.5 mt-1", isPositive ? "text-primary" : "text-destructive")}>
              {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              <span className="text-sm font-semibold">{isPositive ? "+" : ""}{fmt(netPnl)} P&L histórico</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Para depositar o retirar fondos, usa Kraken Pro directamente.</p>
          </>
        )}
      </div>

      {/* Assets */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Activos en Kraken</h3>
        {portfolio.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">Sin activos detectados. Verifica las API keys en Ajustes.</p>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {portfolio.map(p => (
            <div key={p.asset} className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-foreground">{p.asset.replace('X','').replace('Z','')}</span>
                <span className={cn("text-xs font-semibold", p.change24h >= 0 ? "text-primary" : "text-destructive")}>
                  {p.change24h >= 0 ? "+" : ""}{p.change24h}%
                </span>
              </div>
              <p className="text-xl font-mono font-bold text-foreground">{fmt(p.usdValue)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{p.amount.toFixed(6)} · ${p.usdPrice?.toLocaleString('en-US', {maximumFractionDigits: 2})}/u</p>
              <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                <div className="bg-primary h-1.5 rounded-full" style={{ width: `${p.pct_of_total || 0}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{p.pct_of_total}% del portfolio</p>
            </div>
          ))}
        </div>
      </div>

      {/* Historial de trades reales */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Historial de Operaciones (Kraken)</h3>
          <span className="text-xs text-muted-foreground">{krakenTrades.length} operaciones</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 font-medium">Par</th>
                <th className="text-left py-2 font-medium">Tipo</th>
                <th className="text-right py-2 font-medium">Precio</th>
                <th className="text-right py-2 font-medium">Volumen</th>
                <th className="text-right py-2 font-medium">Coste</th>
                <th className="text-right py-2 font-medium">Net P&L</th>
                <th className="text-right py-2 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {krakenTrades.slice(0, 20).map((t, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 font-mono font-semibold text-foreground">{t.pair}</td>
                  <td className="py-2.5"><span className={t.type === "buy" ? "text-profit" : "text-loss"}>{t.type?.toUpperCase()}</span></td>
                  <td className="py-2.5 text-right font-mono">${parseFloat(t.price).toLocaleString('en-US', {maximumFractionDigits: 2})}</td>
                  <td className="py-2.5 text-right font-mono">{parseFloat(t.vol).toFixed(6)}</td>
                  <td className="py-2.5 text-right font-mono">${parseFloat(t.cost).toFixed(2)}</td>
                  <td className={cn("py-2.5 text-right font-mono font-semibold", (t.net || 0) >= 0 ? "text-profit" : "text-loss")}>
                    {(t.net || 0) >= 0 ? "+" : ""}{(t.net || 0).toFixed(4)}
                  </td>
                  <td className="py-2.5 text-right text-muted-foreground">{new Date(t.time).toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {krakenTrades.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {loading ? "Cargando operaciones de Kraken..." : "Sin historial de operaciones"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}