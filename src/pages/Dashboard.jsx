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
  const { data: sessions = [] } = useQuery({ queryKey: ["activeBotSession"], queryFn: () => base44.entities.BotSession.filter({ active: true }), refetchInterval: 30000 });
  const { portfolio, totalUSD, openOrders, loading: loadingKraken, error: krakenError, refresh: fetchKrakenBalance, fetchedAt } = useKrakenData({ intervalMs: 60000 });
  const activeMode = sessions[0]?.mode === "demo" ? "demo" : "live";
  const isDemo = activeMode === "demo";
  const { data: appTrades = [] } = useQuery({ queryKey: ["dashboard-trades", activeMode], queryFn: () => base44.entities.Trade.filter({ mode: activeMode }, "-created_date", 50), refetchInterval: 30000 });

  const activeBots = bots.filter(bot => bot.status === "active").length;
  const visibleOpenOrders = isDemo ? [] : openOrders;
  const closedTrades = appTrades.filter(trade => trade.status === "closed");
  const netPnl = closedTrades.reduce((sum, trade) => sum + (trade.profit_loss || 0), 0);
  const winTrades = closedTrades.filter(trade => (trade.profit_loss || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winTrades / closedTrades.length) * 100 : 0;
  const roiPct = totalUSD > 0 ? (netPnl / totalUSD) * 100 : 0;

  const equityData = [...closedTrades].reverse().reduce((rows, trade, index) => {
    const previous = rows[index - 1]?.value || 0;
    rows.push({ day: new Date(trade.exit_date || trade.updated_date).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }), value: Number((previous + (trade.profit_loss || 0)).toFixed(6)) });
    return rows;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h2><p className="text-sm text-muted-foreground mt-1">Centro de control</p></div>
        <button onClick={fetchKrakenBalance} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className={cn("w-3.5 h-3.5", loadingKraken && "animate-spin")} />Actualizar Kraken</button>
      </div>

      {!isDemo && <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /><span className="text-sm font-semibold text-foreground">Portfolio Real Kraken</span>{loadingKraken && <span className="text-xs text-muted-foreground animate-pulse">Actualizando...</span>}{fetchedAt && !loadingKraken && <span className="text-[10px] text-muted-foreground">{new Date(fetchedAt).toLocaleTimeString("es-ES")}</span>}</div>
          {totalUSD > 0 && <span className="text-lg font-mono font-bold text-foreground">${totalUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD</span>}
        </div>
        {krakenError && <p className="text-sm text-destructive">{krakenError} — verifica las API keys en Ajustes.</p>}
        {portfolio.length > 0 && <div className="space-y-2">{portfolio.map(asset => <div key={asset.asset} className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-1 h-8 rounded-full bg-primary/40" style={{ opacity: asset.pct_of_total / 100 + 0.2 }} /><div><span className="text-xs font-bold text-foreground">{asset.asset.replace("X", "").replace("Z", "")}</span><p className="text-[10px] text-muted-foreground">{asset.amount.toFixed(6)} · ${asset.usdPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}/u</p></div></div><div className="text-right"><p className="text-xs font-mono font-bold text-foreground">${asset.usdValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p><span className={`text-[10px] font-semibold flex items-center justify-end gap-0.5 ${asset.change24h >= 0 ? "text-primary" : "text-destructive"}`}>{asset.change24h >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}{asset.change24h >= 0 ? "+" : ""}{asset.change24h}%</span></div></div>)}</div>}
      </div>}

      {isDemo && <div className="bg-accent/10 border border-accent/25 rounded-xl p-4"><p className="text-sm font-semibold text-accent">MODO DEMO — Capital ficticio. Ninguna operación es real.</p><p className="text-xs text-muted-foreground mt-1">Las métricas se leen desde Trade en modo demo.</p></div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Balance Total" value={isDemo ? 10000 : totalUSD} prefix="$" icon={DollarSign} change={isDemo ? 0 : roiPct} positive={isDemo || roiPct >= 0} />
        <StatCard label="P&L Real" value={netPnl} prefix="$" icon={TrendingUp} change={roiPct} positive={netPnl >= 0} />
        <StatCard label="Win Rate" value={winRate} suffix="%" icon={Percent} positive={winRate >= 50} />
        <StatCard label="Trades Trade" value={appTrades.length} icon={Shield} positive={true} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground uppercase tracking-wider">Bots Activos</span><p className="text-xl font-mono font-bold text-primary mt-1">{activeBots}<span className="text-muted-foreground text-sm">/{bots.length}</span></p></div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground uppercase tracking-wider">Trades Abiertos</span><p className="text-xl font-mono font-bold text-foreground mt-1">{appTrades.filter(trade => trade.status === "open").length}</p></div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground uppercase tracking-wider">Órdenes Kraken</span><p className="text-xl font-mono font-bold text-foreground mt-1">{visibleOpenOrders.length}</p></div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground uppercase tracking-wider">Estado</span><div className="flex items-center gap-2 mt-1"><div className="w-2 h-2 rounded-full bg-primary animate-pulse" /><span className="text-sm font-medium text-primary">Normal</span></div></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5"><h3 className="text-sm font-semibold text-foreground mb-4">Curva de PnL desde Trade</h3><div className="h-56">{equityData.length === 0 ? <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Sin operaciones cerradas todavía</div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={equityData}><defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(160,59%,40%)" stopOpacity={0.3} /><stop offset="100%" stopColor="hsl(160,59%,40%)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" /><XAxis dataKey="day" tick={{ fill: "hsl(215,15%,55%)", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "hsl(224,35%,10%)", border: "1px solid hsl(224,20%,18%)", borderRadius: 8, color: "hsl(210,20%,92%)", fontSize: 12 }} /><Area type="monotone" dataKey="value" stroke="hsl(160,59%,40%)" strokeWidth={2} fill="url(#eqGrad)" dot={false} /></AreaChart></ResponsiveContainer>}</div></div>
        <div className="space-y-3"><h3 className="text-sm font-semibold text-foreground">Estado de Bots</h3>{bots.map(bot => <BotCard key={bot.id} bot={bot} compact />)}{bots.length === 0 && <p className="text-sm text-muted-foreground">Tus bots aparecerán aquí</p>}</div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5"><h3 className="text-sm font-semibold text-foreground mb-4">Últimas Operaciones desde Trade</h3><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-muted-foreground border-b border-border"><th className="text-left py-2 font-medium">Par</th><th className="text-left py-2 font-medium">Estado</th><th className="text-left py-2 font-medium">Tipo</th><th className="text-right py-2 font-medium">Entrada</th><th className="text-right py-2 font-medium">Salida</th><th className="text-right py-2 font-medium">Volumen</th><th className="text-right py-2 font-medium">PnL</th><th className="text-right py-2 font-medium">Orden</th><th className="text-right py-2 font-medium">Cierre</th></tr></thead><tbody>{appTrades.slice(0, 10).map(trade => <tr key={trade.id} className="border-b border-border/50 hover:bg-muted/30"><td className="py-2.5 font-mono font-semibold text-foreground">{trade.pair}</td><td className="py-2.5">{trade.status}</td><td className="py-2.5"><span className={trade.side === "buy" ? "text-profit" : "text-loss"}>{trade.side?.toUpperCase()}</span></td><td className="py-2.5 text-right font-mono">${trade.entry_price?.toLocaleString()}</td><td className="py-2.5 text-right font-mono">{trade.exit_price ? `$${trade.exit_price.toLocaleString()}` : "—"}</td><td className="py-2.5 text-right font-mono">{Number(trade.amount || 0).toFixed(8)}</td><td className={`py-2.5 text-right font-mono font-semibold ${(trade.profit_loss || 0) >= 0 ? "text-profit" : "text-loss"}`}>{trade.profit_loss != null ? `${trade.profit_loss >= 0 ? "+" : ""}${trade.profit_loss.toFixed(6)}` : "—"}</td><td className="py-2.5 text-right font-mono text-[10px]">{trade.exchange_order_id || "—"}</td><td className="py-2.5 text-right font-mono text-[10px]">{trade.close_order_id || "—"}</td></tr>)}</tbody></table>{appTrades.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Sin operaciones registradas en Trade</p>}</div></div>
    </div>
  );
}