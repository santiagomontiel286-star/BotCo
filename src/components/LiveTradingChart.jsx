import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Zap, Clock, Target, Activity } from "lucide-react";

const PAIRS = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "BTC/EUR", "ETH/EUR"];

function generateCandle(base, idx) {
  const noise = (Math.random() - 0.48) * base * 0.008;
  return {
    t: idx,
    price: parseFloat((base + noise).toFixed(2)),
    time: new Date(Date.now() - (59 - idx) * 5000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function generateSignal(capital) {
  const pair = PAIRS[Math.floor(Math.random() * PAIRS.length)];
  const side = Math.random() > 0.5 ? "buy" : "sell";
  const price = pair.startsWith("BTC") ? 67000 + Math.random() * 3000 : pair.startsWith("ETH") ? 3500 + Math.random() * 500 : 150 + Math.random() * 50;
  const size = parseFloat(((capital * 0.01) / price).toFixed(6));
  const tp = parseFloat((price * (side === "buy" ? 1.015 : 0.985)).toFixed(2));
  const sl = parseFloat((price * (side === "buy" ? 0.990 : 1.010)).toFixed(2));
  return { pair, side, price: parseFloat(price.toFixed(2)), size, tp, sl, confidence: Math.floor(65 + Math.random() * 30), status: "pending", id: Date.now() + Math.random() };
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs">
      <p className="text-foreground font-mono font-semibold">${payload[0]?.value?.toLocaleString()}</p>
      <p className="text-muted-foreground">{payload[0]?.payload?.time}</p>
    </div>
  );
};

export default function LiveTradingChart({ active, capital }) {
  const [selectedPair, setSelectedPair] = useState("BTC/USD");
  const [priceData, setPriceData] = useState(() => {
    const base = 67000;
    return Array.from({ length: 60 }, (_, i) => generateCandle(base, i));
  });
  const [signals, setSignals] = useState([]);
  const [closedTrades, setClosedTrades] = useState([]);
  const lastPrice = useRef(67000);

  const { data: trades = [] } = useQuery({
    queryKey: ["trades-live"],
    queryFn: () => base44.entities.Trade.list("-created_date", 5),
    refetchInterval: active ? 8000 : false,
  });

  // Update price chart
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const noise = (Math.random() - 0.47) * lastPrice.current * 0.005;
      lastPrice.current = parseFloat((lastPrice.current + noise).toFixed(2));
      setPriceData(prev => {
        const next = [...prev.slice(1), {
          t: prev[prev.length - 1].t + 1,
          price: lastPrice.current,
          time: new Date().toLocaleTimeString("es-ES"),
        }];
        return next;
      });
    }, 2000);
    return () => clearInterval(t);
  }, [active]);

  // Generate AI signals
  useEffect(() => {
    if (!active || !capital) return;
    const t = setInterval(() => {
      const sig = generateSignal(capital);
      setSignals(prev => [sig, ...prev].slice(0, 6));
      // After 8s, "execute" the signal
      setTimeout(() => {
        setSignals(prev => prev.map(s => s.id === sig.id ? { ...s, status: "open" } : s));
        // After 20s more, "close"
        setTimeout(() => {
          const pnl = parseFloat(((Math.random() - 0.4) * capital * 0.015).toFixed(2));
          setClosedTrades(prev => [{ ...sig, status: "closed", pnl, closedAt: new Date().toLocaleTimeString("es-ES") }, ...prev].slice(0, 8));
          setSignals(prev => prev.filter(s => s.id !== sig.id));
        }, 20000);
      }, 8000);
    }, 12000);
    return () => clearInterval(t);
  }, [active, capital]);

  const currentPrice = priceData[priceData.length - 1]?.price || 0;
  const prevPrice = priceData[priceData.length - 2]?.price || currentPrice;
  const priceUp = currentPrice >= prevPrice;
  const openSignals = signals.filter(s => s.status === "open");
  const pendingSignals = signals.filter(s => s.status === "pending");

  return (
    <div className="space-y-4">
      {/* Chart header */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("w-2 h-2 rounded-full", active ? "bg-primary animate-pulse" : "bg-muted-foreground")} />
            <span className="text-sm font-semibold text-foreground">Monitor de Precio en Vivo</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {PAIRS.map(p => (
              <button key={p} onClick={() => setSelectedPair(p)}
                className={cn("px-2.5 py-1 text-[10px] font-semibold rounded-md transition-colors border",
                  selectedPair === p ? "bg-primary/20 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Price display */}
        <div className="flex items-baseline gap-3 mb-4">
          <span className={cn("text-3xl font-mono font-bold", priceUp ? "text-primary" : "text-destructive")}>
            ${currentPrice.toLocaleString()}
          </span>
          <span className={cn("text-sm font-mono flex items-center gap-1", priceUp ? "text-primary" : "text-destructive")}>
            {priceUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {priceUp ? "+" : ""}{((currentPrice - priceData[0]?.price) / priceData[0]?.price * 100).toFixed(2)}%
          </span>
          {active && <span className="text-[10px] text-muted-foreground bg-primary/10 px-2 py-0.5 rounded-full">EN VIVO</span>}
        </div>

        {/* Chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={priceData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,15%)" />
              <XAxis dataKey="time" tick={{ fill: "hsl(215,15%,45%)", fontSize: 9 }} axisLine={false} tickLine={false} interval={11} />
              <YAxis tick={{ fill: "hsl(215,15%,45%)", fontSize: 9 }} axisLine={false} tickLine={false} domain={["dataMin - 200", "dataMax + 200"]} width={65} tickFormatter={v => `$${v.toLocaleString()}`} />
              <Tooltip content={<CustomTooltip />} />
              {openSignals.map(s => (
                <ReferenceLine key={s.id} y={s.price} stroke={s.side === "buy" ? "hsl(160,59%,40%)" : "hsl(0,70%,55%)"} strokeDasharray="4 2" strokeWidth={1.5} />
              ))}
              <Line type="monotone" dataKey="price" stroke={priceUp ? "hsl(160,59%,40%)" : "hsl(0,70%,55%)"} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Active & Pending signals */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Señales IA en Curso</span>
            {active && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">{signals.length} activas</span>}
          </div>

          {!active && (
            <div className="text-center py-8">
              <Zap className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Activa los bots para ver señales en tiempo real</p>
            </div>
          )}

          {active && signals.length === 0 && (
            <div className="text-center py-8">
              <Clock className="w-6 h-6 text-muted-foreground mx-auto mb-2 animate-pulse" />
              <p className="text-xs text-muted-foreground">Analizando mercado... La primera señal llegará pronto</p>
            </div>
          )}

          <div className="space-y-2">
            {pendingSignals.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-chart-3/5 border border-chart-3/20 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-chart-3 animate-pulse" />
                  <div>
                    <span className="text-xs font-bold text-foreground">{s.pair}</span>
                    <p className="text-[10px] text-muted-foreground">Evaluando entrada... {s.confidence}% conf.</p>
                  </div>
                </div>
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", s.side === "buy" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive")}>
                  {s.side === "buy" ? "LONG" : "SHORT"}
                </span>
              </div>
            ))}
            {openSignals.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <div>
                    <span className="text-xs font-bold text-foreground">{s.pair}</span>
                    <p className="text-[10px] text-muted-foreground">${s.price.toLocaleString()} · TP: ${s.tp} · SL: ${s.sl}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", s.side === "buy" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive")}>
                    {s.side === "buy" ? "LONG" : "SHORT"}
                  </span>
                  <p className="text-[10px] text-primary mt-0.5">ABIERTA</p>
                </div>
              </div>
            ))}
          </div>

          {/* Recent DB trades */}
          {trades.filter(t => t.status === "open").slice(0, 3).map(t => (
            <div key={t.id} className="flex items-center justify-between bg-muted/30 border border-border/50 rounded-lg p-2.5 mt-2">
              <div>
                <span className="text-xs font-bold text-foreground">{t.pair}</span>
                <p className="text-[10px] text-muted-foreground">{t.bot_name} · ${t.entry_price?.toLocaleString()}</p>
              </div>
              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", t.side === "buy" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive")}>
                {t.side?.toUpperCase()}
              </span>
            </div>
          ))}
        </div>

        {/* Closed trades feed */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Operaciones Cerradas</span>
          </div>

          {closedTrades.length === 0 && !active && (
            <div className="text-center py-8">
              <Target className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Las operaciones completadas aparecerán aquí</p>
            </div>
          )}

          {active && closedTrades.length === 0 && (
            <div className="text-center py-8">
              <Clock className="w-6 h-6 text-muted-foreground mx-auto mb-2 animate-pulse" />
              <p className="text-xs text-muted-foreground">Esperando el cierre de la primera operación...</p>
            </div>
          )}

          <div className="space-y-2">
            {closedTrades.map((t, i) => (
              <div key={i} className={cn("flex items-center justify-between rounded-lg p-2.5 border", t.pnl >= 0 ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20")}>
                <div className="flex items-center gap-2">
                  <div className={cn("w-1.5 h-1.5 rounded-full", t.pnl >= 0 ? "bg-primary" : "bg-destructive")} />
                  <div>
                    <span className="text-xs font-bold text-foreground">{t.pair}</span>
                    <p className="text-[10px] text-muted-foreground">{t.closedAt} · {t.side === "buy" ? "LONG" : "SHORT"}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("text-xs font-mono font-bold", t.pnl >= 0 ? "text-primary" : "text-destructive")}>
                    {t.pnl >= 0 ? "+" : ""}{t.pnl?.toFixed(2)} USD
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {t.pnl >= 0 ? "+" : ""}{((t.pnl / (capital || 1)) * 100).toFixed(3)}%
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary if any closed */}
          {closedTrades.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs">
              <span className="text-muted-foreground">P&amp;L acumulado sesión</span>
              <span className={cn("font-mono font-bold", closedTrades.reduce((s, t) => s + t.pnl, 0) >= 0 ? "text-primary" : "text-destructive")}>
                {closedTrades.reduce((s, t) => s + t.pnl, 0) >= 0 ? "+" : ""}
                {closedTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2)} USD
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}