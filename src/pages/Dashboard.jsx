import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { DollarSign, TrendingUp, Percent, Shield, Wallet, RefreshCw, TrendingDown } from "lucide-react";
import useKrakenData from "../hooks/useKrakenData";
import StatCard from "../components/StatCard";
import BotCard from "../components/BotCard";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list() });
  const { portfolio, totalUSD, openOrders, trades: krakenTrades, loading: loadingKraken, error: krakenError, refresh: fetchKrakenBalance, fetchedAt } = useKrakenData({ intervalMs: 30000 });

  const activeBots = bots.filter(b => b.status === "active").length;

  // Real Kraken metrics
  const netPnl = krakenTrades.reduce((s, t) => s + (t.net || 0), 0);
  const winTrades = krakenTrades.filter(t => t.net > 0).length;
  const winRate = krakenTrades.length > 0 ? (winTrades / krakenTrades.length) * 100 : 0;
  const roiPct = totalUSD > 0 && netPnl !== 0 ? (netPnl / (totalUSD - netPnl)) * 100 : 0;

  // Real equity curve from Kraken trade history (oldest → newest)
  const equityData = (() => {
    if (krakenTrades.length === 0) return [];
    const sorted = [...krakenTrades].reverse();
    let running = totalUSD - netPnl;
    return sorted.map(t => {
      running += (t.net || 0);
      return { day: new Date(t.time).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), value: parseFloat(running.toFixed(2)) };
    });
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Centro de control</p>
        </div>
        <button onClick={fetchKrakenBalance} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", loadingKraken && "animate-spin")} />
          Actualizar Kraken
        </button>
      </div>

      {/* Kraken Real Balance */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Portfolio Real Kraken</span>
            {loadingKraken && <span className="text-xs text-muted-foreground animate-pulse">Actualizando...</span>}
            {fetchedAt && !loadingKraken && <span className="text-[10px] text-muted-foreground">{new Date(fetchedAt).toLocaleTimeString('es-ES')}</span>}
          </div>
          <div className="flex items-center gap-3">
            {totalUSD > 0 && <span className="text-lg font-mono font-bold text-foreground">${totalUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD</span>}
            <button onClick={fetchKrakenBalance} className="text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingKraken ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {krakenError && <p className="text-sm text-destructive">{krakenError} — verifica las API keys en Ajustes.</p>}
        {portfolio.length > 0 && (
          <div className="space-y-2">
            {portfolio.map(p => (
              <div key={p.asset} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-8 rounded-full bg-primary/40" style={{ opacity: p.pct_of_total / 100 + 0.2 }} />
                  <div>
                    <span className="text-xs font-bold text-foreground">{p.asset.replace('X','').replace('Z','')}</span>
                    <p className="text-[10px] text-muted-foreground">{p.amount.toFixed(6)} · ${p.usdPrice.toLocaleString('en-US', {maximumFractionDigits: 2})}/u</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono font-bold text-foreground">${p.usdValue.toLocaleString('en-US', {maximumFractionDigits: 2})}</p>
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-[10px] text-muted-foreground">{p.pct_of_total}%</span>
                    <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${p.change24h >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {p.change24h >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      {p.change24h >= 0 ? '+' : ''}{p.change24h}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!loadingKraken && portfolio.length === 0 && !krakenError && (
          <p className="text-sm text-muted-foreground">Sin activos detectados en Kraken.</p>
        )}
        {openOrders.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <p className="text-[10px] text-muted-foreground mb-1.5">Órdenes abiertas en Kraken ({openOrders.length})</p>
            {openOrders.map((o, i) => (
              <div key={i} className="flex justify-between text-[10px] py-0.5">
                <span className="text-foreground font-semibold">{o.pair}</span>
                <span className={o.type === 'buy' ? 'text-primary' : 'text-destructive'}>{o.type?.toUpperCase()} {o.ordertype}</span>
                <span className="text-muted-foreground">{o.vol} @ ${o.price.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Balance Total" value={totalUSD} prefix="$" icon={DollarSign} change={roiPct} positive={roiPct >= 0} />
        <StatCard label="P&L Acumulado" value={netPnl} prefix="$" icon={TrendingUp} change={roiPct} positive={netPnl >= 0} />
        <StatCard label="Win Rate" value={winRate} suffix="%" icon={Percent} positive={winRate >= 50} />
        <StatCard label="Trades Totales" value={krakenTrades.length} icon={Shield} positive={true} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Bots Activos</span>
          <p className="text-xl font-mono font-bold text-primary mt-1">{activeBots}<span className="text-muted-foreground text-sm">/{bots.length}</span></p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Órdenes Abiertas</span>
          <p className="text-xl font-mono font-bold text-foreground mt-1">{openOrders.length}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Riesgo Máx/Trade</span>
          <p className="text-xl font-mono font-bold text-chart-3 mt-1">0.5%</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Estado Mercado</span>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium text-primary">Normal</span>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Curva de Equity (historial real Kraken)</h3>
          <div className="h-56">
            {equityData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {loadingKraken ? "Cargando datos de Kraken..." : "Sin historial de trades disponible"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityData}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(160,59%,40%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(160,59%,40%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
                  <XAxis dataKey="day" tick={{ fill: "hsl(215,15%,55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 10 }} axisLine={false} tickLine={false} domain={["dataMin - 10", "dataMax + 10"]} />
                  <Tooltip contentStyle={{ background: "hsl(224,35%,10%)", border: "1px solid hsl(224,20%,18%)", borderRadius: 8, color: "hsl(210,20%,92%)", fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" stroke="hsl(160,59%,40%)" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Estado de Bots</h3>
          {bots.map(bot => <BotCard key={bot.id} bot={bot} compact />)}
          {bots.length === 0 && <p className="text-sm text-muted-foreground">Tus bots aparecerán aquí</p>}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Últimas Operaciones (Kraken)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 font-medium">Par</th>
                <th className="text-left py-2 font-medium">Tipo</th>
                <th className="text-right py-2 font-medium">Precio</th>
                <th className="text-right py-2 font-medium">Volumen</th>
                <th className="text-right py-2 font-medium">Coste</th>
                <th className="text-right py-2 font-medium">Net P&amp;L</th>
                <th className="text-right py-2 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {krakenTrades.slice(0, 10).map((t, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 font-mono font-semibold text-foreground">{t.pair}</td>
                  <td className="py-2.5"><span className={t.type === "buy" ? "text-profit" : "text-loss"}>{t.type?.toUpperCase()}</span></td>
                  <td className="py-2.5 text-right font-mono">${parseFloat(t.price).toLocaleString('en-US', {maximumFractionDigits:2})}</td>
                  <td className="py-2.5 text-right font-mono">{parseFloat(t.vol).toFixed(6)}</td>
                  <td className="py-2.5 text-right font-mono">${parseFloat(t.cost).toFixed(2)}</td>
                  <td className={`py-2.5 text-right font-mono font-semibold ${(t.net || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                    {(t.net || 0) >= 0 ? "+" : ""}{(t.net || 0).toFixed(4)}
                  </td>
                  <td className="py-2.5 text-right text-muted-foreground">{new Date(t.time).toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {krakenTrades.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {loadingKraken ? "Cargando trades de Kraken..." : "Sin historial de trades en Kraken"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}