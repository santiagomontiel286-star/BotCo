import { Brain, TrendingUp, TrendingDown, AlertTriangle, Zap, Shield, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

const radarData = [
  { factor: "Tendencia", value: 72 },
  { factor: "Volatilidad", value: 45 },
  { factor: "Volumen", value: 63 },
  { factor: "Sentimiento", value: 55 },
  { factor: "Momentum", value: 68 },
  { factor: "Soporte", value: 80 },
];

const insights = [
  { icon: TrendingUp, label: "Tendencia BTC", value: "Alcista moderada", color: "text-profit", desc: "EMA 20 cruzó EMA 50 al alza. Confirmación pendiente." },
  { icon: BarChart3, label: "Volatilidad", value: "Media-baja", color: "text-chart-3", desc: "ATR 14 en rango normal. Sin señales de expansión." },
  { icon: Zap, label: "Probabilidad subida", value: "62%", color: "text-profit", desc: "Basado en análisis multi-factor y sentiment social." },
  { icon: TrendingDown, label: "Probabilidad bajada", value: "38%", color: "text-loss", desc: "Resistencia en $69,200. Posible rechazo." },
  { icon: AlertTriangle, label: "Sentimiento mercado", value: "Neutral-Miedo", color: "text-chart-3", desc: "Fear & Greed en 42. Twitter sentiment mixto." },
  { icon: Shield, label: "Recomendación riesgo", value: "Conservador", color: "text-primary", desc: "Mantener posiciones pequeñas. No apalancar." },
];

const aiAlerts = [
  { severity: "warning", msg: "Volatilidad creciente detectada en ETH — reducir exposición", time: "Hace 12 min" },
  { severity: "info", msg: "Soporte fuerte en BTC $65,400 — zona de acumulación", time: "Hace 28 min" },
  { severity: "critical", msg: "Risk Guardian sugiere pausar Mean Reversion Bot", time: "Hace 1h" },
  { severity: "success", msg: "Trend Following Bot: take profit alcanzado en SOL/USDT +1.8%", time: "Hace 2h" },
  { severity: "info", msg: "Volumen BTC incrementando 15% vs media 24h", time: "Hace 3h" },
];

const sevColors = {
  info: "border-l-accent bg-accent/5",
  warning: "border-l-chart-3 bg-chart-3/5",
  critical: "border-l-destructive bg-destructive/5",
  success: "border-l-primary bg-primary/5",
};

export default function AIAnalysis() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center glow-green-sm">
          <Brain className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Análisis IA</h2>
          <p className="text-sm text-muted-foreground">Motor de inteligencia artificial para decisiones de trading</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {insights.map((item, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-4 hover:border-primary/20 transition-all">
            <div className="flex items-center gap-2 mb-2">
              <item.icon className={cn("w-4 h-4", item.color)} />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{item.label}</span>
            </div>
            <p className={cn("text-lg font-bold font-mono mb-1", item.color)}>{item.value}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Radar Multi-Factor</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(224,20%,18%)" />
                <PolarAngleAxis dataKey="factor" tick={{ fill: "hsl(215,15%,55%)", fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Score" dataKey="value" stroke="hsl(160,59%,40%)" fill="hsl(160,59%,40%)" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Alertas IA</h3>
          <div className="space-y-2">
            {aiAlerts.map((a, i) => (
              <div key={i} className={cn("border-l-2 rounded-r-lg p-3", sevColors[a.severity])}>
                <p className="text-xs text-foreground leading-relaxed">{a.msg}</p>
                <span className="text-[10px] text-muted-foreground mt-1 block">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}