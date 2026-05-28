import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Shield, AlertTriangle, Target, TrendingDown, Lock, Pause } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";

const ddData = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}`,
  dd: -(Math.random() * 3 + Math.sin(i / 5) * 1.5).toFixed(2)
}));

const dailyPL = Array.from({ length: 14 }, (_, i) => ({
  day: `D${i + 1}`,
  pl: +((Math.random() - 0.4) * 2).toFixed(2)
}));

const riskRules = [
  { icon: Target, label: "Stop Loss Automático", value: "2%", desc: "Se activa automáticamente en cada operación" },
  { icon: TrendingDown, label: "Take Profit", value: "3%", desc: "Cierra posición al alcanzar objetivo" },
  { icon: Shield, label: "Trailing Stop", value: "1%", desc: "Protege ganancias siguiendo el precio" },
  { icon: Lock, label: "Riesgo Máx/Trade", value: "0.5%", desc: "Límite absoluto por operación individual" },
  { icon: Pause, label: "Pausa Automática", value: "3 pérdidas", desc: "Detiene bot tras pérdidas consecutivas" },
  { icon: AlertTriangle, label: "Límite Pérdida Diaria", value: "3%", desc: "Pausa todos los bots si se alcanza" },
];

const tooltipStyle = { background: "hsl(224,35%,10%)", border: "1px solid hsl(224,20%,18%)", borderRadius: 8, color: "hsl(210,20%,92%)", fontSize: 11 };

export default function RiskManagement() {
  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list() });
  const maxDD = bots.length ? Math.max(...bots.map(b => b.max_drawdown || 0)) : 0;
  const avgRisk = bots.length ? (bots.reduce((s, b) => s + (b.risk_level || 0), 0) / bots.length) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-chart-3/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-chart-3" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Gestión de Riesgo</h2>
          <p className="text-sm text-muted-foreground">Protección de capital — estrategia ultra conservadora</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Drawdown Actual</span>
          <p className="text-xl font-mono font-bold text-loss mt-1">-{maxDD.toFixed(2)}%</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Riesgo Promedio</span>
          <p className="text-xl font-mono font-bold text-chart-3 mt-1">{avgRisk.toFixed(1)}%</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 col-span-2 lg:col-span-1">
          <span className="text-xs text-muted-foreground">Estado Protección</span>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-sm font-semibold text-primary">Activa</span>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {riskRules.map((r, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-4 hover:border-primary/20 transition-all">
            <div className="flex items-center gap-2 mb-2">
              <r.icon className="w-4 h-4 text-chart-3" />
              <span className="text-xs font-medium text-foreground">{r.label}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-foreground mb-1">{r.value}</p>
            <p className="text-[11px] text-muted-foreground">{r.desc}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Drawdown (30 días)</h3>
          <div className="h-48">
            <ResponsiveContainer>
              <AreaChart data={ddData}>
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0,70%,55%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(0,70%,55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
                <XAxis dataKey="day" tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="dd" stroke="hsl(0,70%,55%)" strokeWidth={1.5} fill="url(#ddGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">PnL Diario (14 días)</h3>
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={dailyPL}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
                <XAxis dataKey="day" tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="pl" radius={[3, 3, 0, 0]} barSize={16} fill="hsl(160,59%,40%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}