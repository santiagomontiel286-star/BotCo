import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Zap, Clock, Target, Activity } from "lucide-react";

const PAIRS = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "BTC/EUR", "ETH/EUR"];
const KRAKEN_PAIRS = {
  "BTC/USD": "XBTUSD",
  "ETH/USD": "ETHUSD",
  "SOL/USD": "SOLUSD",
  "XRP/USD": "XRPUSD",
  "BTC/EUR": "XBTEUR",
  "ETH/EUR": "ETHEUR",
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs">
      <p className="text-foreground font-mono font-semibold">${payload[0]?.value?.toLocaleString()}</p>
      <p className="text-muted-foreground">{payload[0]?.payload?.time}</p>
    </div>
  );
};

export default function LiveTradingChart({ active, mode = "real", startedAt }) {
  const [selectedPair, setSelectedPair] = useState("BTC/USD");
  const [priceData, setPriceData] = useState([]);

  const { data: trades = [] } = useQuery({
    queryKey: ["trades-live", mode],
    queryFn: () => base44.entities.Trade.filter({ mode }, "-created_date", 20),
    refetchInterval: active ? 8000 : false,
  });

  const { data: candles = [] } = useQuery({
    queryKey: ["kraken-ohlc-monitor", selectedPair],
    queryFn: async () => {
      const response = await base44.functions.invoke("krakenOHLC", {
        pair: KRAKEN_PAIRS[selectedPair],
        interval: 15,
      });

      return (response.data.candles || []).map((c, index) => ({
        t: index,
        price: c.close,
        time: new Date(c.t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      }));
    },
    refetchInterval: active ? 30000 : 60000,
    initialData: [],
  });

  useEffect(() => {
    setPriceData(candles);
  }, [candles]);

  const currentPrice = priceData[priceData.length - 1]?.price || 0;
  const prevPrice = priceData[priceData.length - 2]?.price || currentPrice;
  const firstPrice = priceData[0]?.price || currentPrice;
  const priceUp = currentPrice >= prevPrice;
  const priceChangePct = firstPrice ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0;
  const sessionStartMs = startedAt ? new Date(startedAt).getTime() : 0;

  const openSignals = trades
    .filter(t => t.status === "open")
    .map(t => ({
      id: t.id,
      pair: t.pair,
      side: t.side,
      price: t.entry_price,
      tp: t.take_profit,
      sl: t.stop_loss,
    }));

  const closedDbTrades = trades
    .filter(t => t.status === "closed")
    .filter(t => !sessionStartMs || new Date(t.entry_date || t.created_date).getTime() >= sessionStartMs - 60000);

  const currency = mode === "live" || mode === "real" ? "EUR" : "USD";
  const sessionPnl = closedDbTrades.reduce((sum, trade) => sum + (trade.profit_loss || 0), 0);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("w-2 h-2 rounded-full", active ? "bg-primary animate-pulse" : "bg-muted-foreground")} />
            <span className="text-sm font-semibold text-foreground">Monitor de Precio en Vivo</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {PAIRS.map(pair => (
              <button
                key={pair}
                onClick={() => setSelectedPair(pair)}
                className={cn(
                  "px-2.5 py-1 text-[10px] font-semibold rounded-md transition-colors border",
                  selectedPair === pair
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {pair}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-baseline gap-3 mb-4">
          <span className={cn("text-3xl font-mono font-bold", priceUp ? "text-primary" : "text-destructive")}>
            ${currentPrice.toLocaleString()}
          </span>
          <span className={cn("text-sm font-mono flex items-center gap-1", priceUp ? "text-primary" : "text-destructive")}>
            {priceUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(2)}%
          </span>
          {active && <span className="text-[10px] text-muted-foreground bg-primary/10 px-2 py-0.5 rounded-full">EN VIVO</span>}
        </div>

        <div className="h-48">
          {priceData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Cargando velas reales de Kraken...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,15%)" />
                <XAxis dataKey="time" tick={{ fill: "hsl(215,15%,45%)", fontSize: 9 }} axisLine={false} tickLine={false} interval={11} />
                <YAxis tick={{ fill: "hsl(215,15%,45%)", fontSize: 9 }} axisLine={false} tickLine={false} domain={["dataMin - 200", "dataMax + 200"]} width={65} tickFormatter={value => `$${value.toLocaleString()}`} />
                <Tooltip content={<CustomTooltip />} />
                {openSignals.map(signal => (
                  <ReferenceLine key={signal.id} y={signal.price} stroke={signal.side === "buy" ? "hsl(160,59%,40%)" : "hsl(0,70%,55%)"} strokeDasharray="4 2" strokeWidth={1.5} />
                ))}
                <Line type="monotone" dataKey="price" stroke={priceUp ? "hsl(160,59%,40%)" : "hsl(0,70%,55%)"} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Operaciones en Curso</span>
            {active && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">{openSignals.length} abiertas</span>}
          </div>

          {!active && (
            <div className="text-center py-8">
              <Zap className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Activa los bots para ver operaciones reales o demo</p>
            </div>
          )}

          {active && openSignals.length === 0 && (
            <div className="text-center py-8">
              <Clock className="w-6 h-6 text-muted-foreground mx-auto mb-2 animate-pulse" />
              <p className="text-xs text-muted-foreground">Analizando mercado real de Kraken...</p>
            </div>
          )}

          <div className="space-y-2">
            {openSignals.map(signal => (
              <div key={signal.id} className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <div>
                    <span className="text-xs font-bold text-foreground">{signal.pair}</span>
                    <p className="text-[10px] text-muted-foreground">
                      ${signal.price?.toLocaleString()} {signal.tp ? `· TP: ${signal.tp}` : ""} {signal.sl ? `· SL: ${signal.sl}` : ""}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", signal.side === "buy" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive")}>
                    {signal.side === "buy" ? "LONG" : "SHORT"}
                  </span>
                  <p className="text-[10px] text-primary mt-0.5">ABIERTA</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Operaciones Cerradas</span>
          </div>

          {closedDbTrades.length === 0 && !active && (
            <div className="text-center py-8">
              <Target className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Las operaciones completadas aparecerán aquí</p>
            </div>
          )}

          {active && closedDbTrades.length === 0 && (
            <div className="text-center py-8">
              <Clock className="w-6 h-6 text-muted-foreground mx-auto mb-2 animate-pulse" />
              <p className="text-xs text-muted-foreground">Esperando el cierre de la primera operación...</p>
            </div>
          )}

          <div className="space-y-2">
            {closedDbTrades.map(trade => {
              const pnl = trade.profit_loss || 0;
              return (
                <div key={trade.id} className={cn("flex items-center justify-between rounded-lg p-2.5 border", pnl >= 0 ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20")}>
                  <div className="flex items-center gap-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full", pnl >= 0 ? "bg-primary" : "bg-destructive")} />
                    <div>
                      <span className="text-xs font-bold text-foreground">{trade.pair}</span>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(trade.exit_date || trade.updated_date).toLocaleTimeString("es-ES")} · {trade.side === "buy" ? "LONG" : "SHORT"} · {mode.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-xs font-mono font-bold", pnl >= 0 ? "text-primary" : "text-destructive")}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(4)} {currency}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {(trade.profit_loss_percent || 0) >= 0 ? "+" : ""}{(trade.profit_loss_percent || 0).toFixed(3)}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {closedDbTrades.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs">
              <span className="text-muted-foreground">P&amp;L acumulado sesión</span>
              <span className={cn("font-mono font-bold", sessionPnl >= 0 ? "text-primary" : "text-destructive")}>
                {sessionPnl >= 0 ? "+" : ""}{sessionPnl.toFixed(4)} {currency}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}