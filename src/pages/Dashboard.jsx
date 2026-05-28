import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { DollarSign, TrendingUp, Percent, Shield, Wallet, RefreshCw } from "lucide-react";
import StatCard from "../components/StatCard";
import BotCard from "../components/BotCard";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";

const equityData = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}`,
  value: 10000 + Math.random() * 400 * (i / 30) + i * 30 - Math.random() * 100
}));

export default function Dashboard() {
  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list() });
  const { data: trades = [] } = useQuery({ queryKey: ["trades"], queryFn: () => base44.entities.Trade.list("-created_date", 10) });
  const [krakenBalance, setKrakenBalance] = useState(null);
  const [loadingKraken, setLoadingKraken] = useState(true);

  const fetchKrakenBalance = async () => {
    setLoadingKraken(true);
    try {
      const res = await base44.functions.invoke('krakenAccount', {});
      if (res.data?.balance) setKrakenBalance(res.data.balance);
    } catch {
      setKrakenBalance(null);
    } finally {
      setLoadingKraken(false);
    }
  };

  useEffect(() => {
    fetchKrakenBalance();
    // Keep connection alive: re-fetch every 30s automatically
    const interval = setInterval(fetchKrakenBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalCapital = bots.reduce((s, b) => s + (b.capital || 0), 0);
  const totalProfit = bots.length ? bots.reduce((s, b) => s + (b.profit || 0), 0) / bots.length : 0;
  const avgWinRate = bots.length ? bots.reduce((s, b) => s + (b.win_rate || 0), 0) / bots.length : 0;
  const maxDD = bots.length ? Math.max(...bots.map(b => b.max_drawdown || 0)) : 0;
  const activeBots = bots.filter(b => b.status === "active").length;
  const openTrades = trades.filter(t => t.status === "open").length;

  const usdBalance = krakenBalance ? (krakenBalance["ZUSD"] || krakenBalance["USD"] || 0) : 0;
  const btcBalance = krakenBalance ? (krakenBalance["XXBT"] || krakenBalance["XBT"] || 0) : 0;
  const ethBalance = krakenBalance ? (krakenBalance["XETH"] || krakenBalance["ETH"] || 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Centro de control — Modo Ultra Conservador</p>
        </div>
        <button onClick={fetchKrakenBalance} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", loadingKraken && "animate-spin")} />
          Actualizar Kraken
        </button>
      </div>

      {/* Kraken Real Balance */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Balance Real Kraken</span>
          {loadingKraken && <span className="text-xs text-muted-foreground animate-pulse">Cargando...</span>}
        </div>
        {krakenBalance ? (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className="text-[10px] text-muted-foreground">USD</span>
              <p className="text-lg font-mono font-bold text-foreground">${usdBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">BTC</span>
              <p className="text-lg font-mono font-bold text-chart-3">{btcBalance.toFixed(6)}</p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">ETH</span>
              <p className="text-lg font-mono font-bold text-accent">{ethBalance.toFixed(4)}</p>
            </div>
            {Object.entries(krakenBalance)
              .filter(([k]) => !['ZUSD','USD','XXBT','XBT','XETH','ETH'].includes(k))
              .map(([asset, amount]) => (
                <div key={asset}>
                  <span className="text-[10px] text-muted-foreground">{asset}</span>
                  <p className="text-sm font-mono font-bold text-foreground">{parseFloat(amount).toFixed(4)}</p>
                </div>
              ))}
          </div>
        ) : (
          !loadingKraken && <p className="text-sm text-muted-foreground">No se pudo conectar con Kraken. Verifica las API keys.</p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Balance Total" value={totalCapital} prefix="$" icon={DollarSign} change={totalProfit} positive={totalProfit >= 0} />
        <StatCard label="ROI Semanal" value={totalProfit} suffix="%" icon={TrendingUp} change={totalProfit * 0.3} positive={totalProfit >= 0} />
        <StatCard label="Win Rate" value={avgWinRate} suffix="%" icon={Percent} positive={avgWinRate >= 50} />
        <StatCard label="Max Drawdown" value={maxDD} suffix="%" icon={Shield} positive={false} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Bots Activos</span>
          <p className="text-xl font-mono font-bold text-primary mt-1">{activeBots}<span className="text-muted-foreground text-sm">/{bots.length}</span></p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Ops Abiertas</span>
          <p className="text-xl font-mono font-bold text-foreground mt-1">{openTrades}</p>
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
          <h3 className="text-sm font-semibold text-foreground mb-4">Curva de Equity</h3>
          <div className="h-56">
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
                <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 10 }} axisLine={false} tickLine={false} domain={["dataMin - 100", "dataMax + 100"]} />
                <Tooltip contentStyle={{ background: "hsl(224,35%,10%)", border: "1px solid hsl(224,20%,18%)", borderRadius: 8, color: "hsl(210,20%,92%)", fontSize: 12 }} />
                <Area type="monotone" dataKey="value" stroke="hsl(160,59%,40%)" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Estado de Bots</h3>
          {bots.map(bot => <BotCard key={bot.id} bot={bot} compact />)}
          {bots.length === 0 && <p className="text-sm text-muted-foreground">Tus bots aparecerán aquí</p>}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Últimas Operaciones</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 font-medium">Bot</th>
                <th className="text-left py-2 font-medium">Par</th>
                <th className="text-left py-2 font-medium">Lado</th>
                <th className="text-right py-2 font-medium">Entrada</th>
                <th className="text-right py-2 font-medium">PnL</th>
                <th className="text-right py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 8).map(t => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 font-medium text-foreground">{t.bot_name}</td>
                  <td className="py-2.5 font-mono text-foreground">{t.pair}</td>
                  <td className="py-2.5"><span className={t.side === "buy" ? "text-profit" : "text-loss"}>{t.side?.toUpperCase()}</span></td>
                  <td className="py-2.5 text-right font-mono">${t.entry_price?.toLocaleString()}</td>
                  <td className={`py-2.5 text-right font-mono font-medium ${(t.profit_loss || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                    {(t.profit_loss || 0) >= 0 ? "+" : ""}{t.profit_loss != null ? t.profit_loss.toFixed(2) : "—"}%
                  </td>
                  <td className="py-2.5 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${t.status === "open" ? "bg-primary/20 text-primary" : t.status === "closed" ? "bg-muted text-muted-foreground" : "bg-destructive/20 text-destructive"}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trades.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Sin operaciones aún — los bots están en espera</p>}
        </div>
      </div>
    </div>
  );
}