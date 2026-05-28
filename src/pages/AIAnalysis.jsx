import { useState, useEffect } from "react";
import { Brain, TrendingUp, TrendingDown, AlertTriangle, Zap, Shield, BarChart3, RefreshCw, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

const sevColors = {
  info: "border-l-accent bg-accent/5",
  warning: "border-l-chart-3 bg-chart-3/5",
  critical: "border-l-destructive bg-destructive/5",
  success: "border-l-primary bg-primary/5",
};

const impactColors = {
  high: "text-loss",
  medium: "text-chart-3",
  low: "text-muted-foreground",
};

const sentimentColor = (s) => s === "bullish" ? "text-profit" : s === "bearish" ? "text-loss" : "text-chart-3";
const actionColor = (a) => a === "buy" ? "bg-primary/20 text-primary" : a === "sell" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground";

export default function AIAnalysis() {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const fetchAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('cryptoNews', {});
      if (res.data?.analysis) {
        setAnalysis(res.data.analysis);
        setLastUpdated(new Date());
      } else {
        setError("No se pudo obtener el análisis. Intenta de nuevo.");
      }
    } catch {
      setError("Error al conectar con el servicio de noticias. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAnalysis(); }, []);

  const radarData = analysis ? [
    { factor: "Tendencia", value: analysis.market_sentiment?.score || 50 },
    { factor: "Sentimiento", value: analysis.market_sentiment?.score || 50 },
    { factor: "Noticias", value: (analysis.news?.filter(n => n.sentiment === "bullish").length || 0) / (analysis.news?.length || 1) * 100 },
    { factor: "Señales", value: (analysis.signals?.filter(s => s.action === "buy").length || 0) / (analysis.signals?.length || 1) * 100 },
    { factor: "Riesgo", value: 100 - (analysis.alerts?.filter(a => a.severity === "critical").length || 0) * 25 },
    { factor: "Confianza", value: analysis.signals?.[0]?.confidence || 60 },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center glow-green-sm">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Análisis IA</h2>
            <p className="text-sm text-muted-foreground">
              {lastUpdated ? `Actualizado: ${lastUpdated.toLocaleTimeString('es-ES')}` : "Motor de inteligencia artificial + datos en tiempo real"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAnalysis} disabled={loading} className="gap-2">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          {loading ? "Analizando..." : "Actualizar"}
        </Button>
      </div>

      {loading && !analysis && (
        <div className="bg-card rounded-xl border border-border p-10 text-center">
          <Brain className="w-8 h-8 text-primary mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-muted-foreground">Leyendo noticias y analizando el mercado en tiempo real...</p>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-sm text-destructive">{error}</div>
      )}

      {analysis && (
        <>
          {/* Summary */}
          {analysis.summary && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Brain className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-foreground leading-relaxed">{analysis.summary}</p>
              </div>
            </div>
          )}

          {/* Market sentiment + signals */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-card rounded-xl border border-border p-4">
              <span className="text-xs text-muted-foreground">Sentimiento</span>
              <p className="text-lg font-bold font-mono text-chart-3 mt-1">{analysis.market_sentiment?.score || "—"}</p>
              <span className="text-[11px] text-muted-foreground">{analysis.market_sentiment?.label}</span>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <span className="text-xs text-muted-foreground">BTC Tendencia</span>
              <p className="text-sm font-bold text-foreground mt-1">{analysis.market_sentiment?.btc_trend || "—"}</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <span className="text-xs text-muted-foreground">ETH Tendencia</span>
              <p className="text-sm font-bold text-foreground mt-1">{analysis.market_sentiment?.eth_trend || "—"}</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <span className="text-xs text-muted-foreground">Señales activas</span>
              <p className="text-lg font-bold font-mono text-primary mt-1">{analysis.signals?.length || 0}</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Radar chart */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Radar Multi-Factor (Tiempo Real)</h3>
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

            {/* Signals */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Señales de Trading IA</h3>
              <div className="space-y-3">
                {(analysis.signals || []).map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
                    <div>
                      <span className="text-sm font-bold text-foreground">{s.asset}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.signal}</p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", actionColor(s.action))}>
                        {s.action?.toUpperCase()}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{s.confidence}% conf.</span>
                    </div>
                  </div>
                ))}
                {!analysis.signals?.length && <p className="text-sm text-muted-foreground">Sin señales activas</p>}
              </div>
            </div>
          </div>

          {/* News */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Newspaper className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Noticias Crypto (Últimas 24h)</h3>
            </div>
            <div className="space-y-3">
              {(analysis.news || []).map((n, i) => (
                <div key={i} className="border border-border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                    <div className="flex gap-1.5 shrink-0">
                      <span className={cn("text-[10px] font-semibold", sentimentColor(n.sentiment))}>{n.sentiment?.toUpperCase()}</span>
                      <span className={cn("text-[10px]", impactColors[n.impact])}>• {n.impact}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{n.summary}</p>
                  {n.source && <span className="text-[10px] text-muted-foreground/60 mt-1 block">{n.source}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Alerts */}
          {analysis.alerts?.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Alertas de Riesgo IA</h3>
              <div className="space-y-2">
                {analysis.alerts.map((a, i) => (
                  <div key={i} className={cn("border-l-2 rounded-r-lg p-3", sevColors[a.severity])}>
                    <p className="text-xs font-semibold text-foreground">{a.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}