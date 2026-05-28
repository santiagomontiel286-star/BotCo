import { useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, BarChart } from "recharts";
import FearGreedGauge from "../components/FearGreedGauge";
import CryptoHeatmap from "../components/CryptoHeatmap";

function generatePriceData(n = 60) {
  let price = 67000, rsi = 50;
  return Array.from({ length: n }, (_, i) => {
    const change = (Math.random() - 0.48) * 800;
    const open = price;
    price += change;
    const high = Math.max(open, price) + Math.random() * 300;
    const low = Math.min(open, price) - Math.random() * 300;
    rsi = Math.max(10, Math.min(90, rsi + (Math.random() - 0.5) * 10));
    const ema20 = price + (Math.random() - 0.5) * 200;
    const ema50 = price + (Math.random() - 0.5) * 500;
    const macd = (Math.random() - 0.5) * 200;
    const signal = macd + (Math.random() - 0.5) * 50;
    const volume = 1000 + Math.random() * 3000;
    return { t: `${i + 1}`, open: +open.toFixed(0), close: +price.toFixed(0), high: +high.toFixed(0), low: +low.toFixed(0), rsi: +rsi.toFixed(1), ema20: +ema20.toFixed(0), ema50: +ema50.toFixed(0), macd: +macd.toFixed(0), signal: +signal.toFixed(0), hist: +(macd - signal).toFixed(0), volume: +volume.toFixed(0) };
  });
}

const tooltipStyle = { background: "hsl(224,35%,10%)", border: "1px solid hsl(224,20%,18%)", borderRadius: 8, color: "hsl(210,20%,92%)", fontSize: 11 };

export default function Market() {
  const data = useMemo(() => generatePriceData(), []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Mercado</h2>
        <p className="text-sm text-muted-foreground mt-1">Análisis técnico y sentimiento cripto</p>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">BTC/USDT — Precio + EMA</h3>
          <span className="text-xs font-mono text-muted-foreground">1H</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
              <XAxis dataKey="t" tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} domain={["dataMin - 500", "dataMax + 500"]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="close" fill="hsl(160,59%,40%)" opacity={0.3} barSize={4} />
              <Line type="monotone" dataKey="ema20" stroke="hsl(200,70%,45%)" strokeWidth={1.5} dot={false} name="EMA 20" />
              <Line type="monotone" dataKey="ema50" stroke="hsl(35,90%,55%)" strokeWidth={1.5} dot={false} name="EMA 50" />
              <Line type="monotone" dataKey="close" stroke="hsl(160,59%,50%)" strokeWidth={2} dot={false} name="Precio" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">RSI (14)</h3>
          <div className="h-40">
            <ResponsiveContainer>
              <AreaChart data={data}>
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
              <ComposedChart data={data}>
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
            <BarChart data={data}>
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
          <h3 className="text-sm font-semibold text-foreground mb-4">{"Fear & Greed Index"}</h3>
          <FearGreedGauge value={42} />
        </div>
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Heatmap Crypto</h3>
          <CryptoHeatmap />
        </div>
      </div>
    </div>
  );
}