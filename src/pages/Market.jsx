import { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, BarChart } from "recharts";
import FearGreedGauge from "../components/FearGreedGauge";
import CryptoHeatmap from "../components/CryptoHeatmap";
import { base44 } from "@/api/base44Client";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

const tooltipStyle = { background: "hsl(224,35%,10%)", border: "1px solid hsl(224,20%,18%)", borderRadius: 8, color: "hsl(210,20%,92%)", fontSize: 11 };

const PAIRS = [
  { key: "XXBTZUSD", label: "BTC/USD" },
  { key: "XETHZUSD", label: "ETH/USD" },
  { key: "SOLUSDT", label: "SOL/USD" },
  { key: "XRPUSDT", label: "XRP/USD" },
];

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return closes.map(() => 50);
  const rsi = [];
  for (let i = 0; i < period; i++) rsi.push(50);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  const ema = [closes[0]];
  for (let i = 1; i < closes.length; i++) ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

export default function Market() {
  const [tickers, setTickers] = useState({});
  const [candles, setCandles] = useState([]);
  const [selectedPair, setSelectedPair] = useState("XXBTZUSD");
  const [loadingTicker, setLoadingTicker] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);

  const fetchTickers = async () => {
    setLoadingTicker(true);
    const res = await base44.functions.invoke('krakenTicker', {});
    if (res.data?.tickers) setTickers(res.data.tickers);
    setLoadingTicker(false);
  };

  const fetchChart = async (pair) => {
    setLoadingChart(true);
    const res = await base44.functions.invoke('krakenOHLC', { pair, interval: 60 });
    if (res.data?.candles) setCandles(res.data.candles);
    setLoadingChart(false);
  };

  useEffect(() => { fetchTickers(); }, []);
  useEffect(() => { fetchChart(selectedPair); }, [selectedPair]);

  const chartData = useMemo(() => {
    if (!candles.length) return [];
    const closes = candles.map(c => c.close);
    const rsiArr = calcRSI(closes);
    const ema20Arr = calcEMA(closes, 20);
    const ema50Arr = calcEMA(closes, 50);
    return candles.map((c, i) => {
      const macd = ema20Arr[i] - ema50Arr[i];
      const signal = ema20Arr[Math.max(0, i - 9)];
      return {
        t: new Date(c.t).getHours() + "h",
        open: c.open, close: c.close, high: c.high, low: c.low,
        volume: c.volume,
        rsi: +rsiArr[i].toFixed(1),
        ema20: +ema20Arr[i].toFixed(2),
        ema50: +ema50Arr[i].toFixed(2),
        macd: +macd.toFixed(2),
        signal: +signal.toFixed(2),
        hist: +(macd - signal).toFixed(2),
      };
    });
  }, [candles]);

  const fearGreedScore = useMemo(() => {
    const t = tickers["XXBTZUSD"];
    if (!t) return 50;
    const change = parseFloat(t.change);
    return Math.min(100, Math.max(0, 50 + change * 3));
  }, [tickers]);

  const currentTicker = tickers[selectedPair];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Mercado</h2>
          <p className="text-sm text-muted-foreground mt-1">Datos en tiempo real de Kraken</p>
        </div>
        <button onClick={() => { fetchTickers(); fetchChart(selectedPair); }} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", loadingTicker && "animate-spin")} />
          Actualizar
        </button>
      </div>

      {/* Live tickers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {PAIRS.map(({ key, label }) => {
          const t = tickers[key];
          const change = t ? parseFloat(t.change) : 0;
          return (
            <button key={key} onClick={() => setSelectedPair(key)}
              className={cn("bg-card rounded-xl border p-3 text-left transition-all hover:border-primary/30",
                selectedPair === key ? "border-primary/50 bg-primary/5" : "border-border")}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-muted-foreground">{label}</span>
                {change >= 0 ? <TrendingUp className="w-3 h-3 text-profit" /> : <TrendingDown className="w-3 h-3 text-loss" />}
              </div>
              <p className="text-lg font-mono font-bold text-foreground">
                {t ? `$${t.last.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : (loadingTicker ? "…" : "—")}
              </p>
              <p className={cn("text-xs font-mono mt-0.5", change >= 0 ? "text-profit" : "text-loss")}>
                {t ? `${change >= 0 ? "+" : ""}${change}%` : ""}
              </p>
            </button>
          );
        })}
      </div>

      {/* OHLC info */}
      {currentTicker && (
        <div className="grid grid-cols-4 gap-2">
          {[
            ["Apertura", `$${currentTicker.open?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`],
            ["Máximo 24h", `$${currentTicker.high?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`],
            ["Mínimo 24h", `$${currentTicker.low?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`],
            ["Volumen 24h", currentTicker.volume?.toFixed(2)],
          ].map(([label, val]) => (
            <div key={label} className="bg-card rounded-lg border border-border p-3">
              <span className="text-[10px] text-muted-foreground">{label}</span>
              <p className="text-sm font-mono font-semibold text-foreground mt-0.5">{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main chart */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {PAIRS.find(p => p.key === selectedPair)?.label} — Precio + EMA (Kraken Real)
          </h3>
          <span className="text-xs font-mono text-muted-foreground">1H</span>
        </div>
        {loadingChart ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Cargando datos...</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
                <XAxis dataKey="t" tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} domain={["dataMin - 100", "dataMax + 100"]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="close" fill="hsl(160,59%,40%)" opacity={0.3} barSize={4} />
                <Line type="monotone" dataKey="ema20" stroke="hsl(200,70%,45%)" strokeWidth={1.5} dot={false} name="EMA 20" />
                <Line type="monotone" dataKey="ema50" stroke="hsl(35,90%,55%)" strokeWidth={1.5} dot={false} name="EMA 50" />
                <Line type="monotone" dataKey="close" stroke="hsl(160,59%,50%)" strokeWidth={2} dot={false} name="Precio" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">RSI (14)</h3>
          <div className="h-40">
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="rsiGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(280,60%,55%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(280,60%,55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
                <XAxis dataKey="t" tick={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} ticks={[30, 50, 70]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="rsi" stroke="hsl(280,60%,55%)" strokeWidth={1.5} fill="url(#rsiGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-2 px-2">
            <span>{"Sobreventa < 30"}</span>
            <span>{"Sobrecompra > 70"}</span>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">MACD</h3>
          <div className="h-40">
            <ResponsiveContainer>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
                <XAxis dataKey="t" tick={false} axisLine={false} />
                <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="hist" fill="hsl(160,59%,40%)" opacity={0.5} barSize={3} name="Histograma" />
                <Line type="monotone" dataKey="macd" stroke="hsl(200,70%,45%)" strokeWidth={1.5} dot={false} name="MACD" />
                <Line type="monotone" dataKey="signal" stroke="hsl(0,70%,55%)" strokeWidth={1.5} dot={false} name="Señal" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Volumen</h3>
        <div className="h-32">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <XAxis dataKey="t" tick={false} axisLine={false} />
              <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="volume" fill="hsl(200,70%,45%)" opacity={0.6} barSize={5} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">{"Fear & Greed (basado en BTC)"}</h3>
          <FearGreedGauge value={fearGreedScore} />
        </div>
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Variación 24h</h3>
          <CryptoHeatmap tickers={tickers} />
        </div>
      </div>
    </div>
  );
}