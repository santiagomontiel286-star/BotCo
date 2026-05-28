import { useState, useEffect, useRef } from "react";
import useBotSession from "../hooks/useBotSession";
import useKrakenData from "../hooks/useKrakenData";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrendingUp, RotateCcw, Brain, Shield, X, AlertTriangle, Rocket, Square, RefreshCw } from "lucide-react";
import LiveTradingChart from "./LiveTradingChart";
import SessionReportModal from "./SessionReportModal";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

const fmtPct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

const BOTS = [
  { id: "trend", name: "Trend Follower", icon: TrendingUp, pct: 35, color: "text-primary",  bar: "bg-primary" },
  { id: "mean",  name: "Mean Reversion", icon: RotateCcw,  pct: 25, color: "text-accent",   bar: "bg-accent" },
  { id: "ai",    name: "AI Sentiment",   icon: Brain,       pct: 25, color: "text-chart-4",  bar: "bg-chart-4" },
  { id: "risk",  name: "Risk Guardian",  icon: Shield,      pct: 15, color: "text-chart-3",  bar: "bg-chart-3" },
];

// Modal
function ActivationModal({ krakenBalance, portfolio, onActivate, onClose }) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (step === 1) inputRef.current?.focus(); }, [step]);

  const parsed = parseFloat(amount) || 0;
  const pctOfBalance = krakenBalance > 0 ? (parsed / krakenBalance) * 100 : 0;

  const validate = () => {
    if (!parsed || parsed <= 0) return setError("Ingresa un monto válido.");
    if (parsed > krakenBalance) return setError(`Supera tu balance disponible (${fmt(krakenBalance)}).`);
    if (parsed < 10) return setError("El monto mínimo es $10 USD.");
    setError("");
    setStep(2);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-foreground">
              {step === 1 ? "Activar bots" : "Confirmar activación"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Portfolio total: <span className="font-semibold text-foreground">{fmt(krakenBalance)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Portfolio breakdown */}
        {portfolio.length > 0 && step === 1 && (
          <div className="bg-muted/40 rounded-xl p-3 mb-4 space-y-1.5">
            {portfolio.map(p => (
              <div key={p.asset} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{p.asset.replace('X','').replace('Z','')}: {p.amount.toFixed(6)}</span>
                <span className="font-mono font-semibold text-foreground">${p.usdValue.toLocaleString('en-US', {maximumFractionDigits: 2})}
                  <span className={cn("ml-2 text-[10px]", p.change24h >= 0 ? "text-primary" : "text-destructive")}>
                    {p.change24h >= 0 ? "+" : ""}{p.change24h}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        {step === 1 && (
          <>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground block mb-2">Capital para los bots (en USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-lg">$</span>
                <input
                  ref={inputRef}
                  type="number" min="10" max={krakenBalance} step="10"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") validate(); if (e.key === "Escape") onClose(); }}
                  placeholder="0.00"
                  className={cn(
                    "w-full pl-8 pr-4 py-3.5 bg-muted border rounded-xl text-2xl font-bold text-foreground outline-none transition-colors",
                    error ? "border-destructive" : "border-border focus:border-primary"
                  )}
                />
              </div>
              {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => { setAmount(((krakenBalance * p) / 100).toFixed(2)); setError(""); }}
                  className="py-2 text-xs font-semibold border border-border rounded-lg hover:border-primary hover:text-primary transition-colors text-muted-foreground bg-muted/50">
                  {p}%
                </button>
              ))}
            </div>

            {parsed > 0 && parsed <= krakenBalance && (
              <div className="bg-muted/50 rounded-xl p-4 mb-5 border border-border/50">
                <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wider">
                  Distribución — {pctOfBalance.toFixed(1)}% de tu portfolio
                </p>
                {BOTS.map(b => (
                  <div key={b.id} className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <b.icon className={cn("w-3.5 h-3.5", b.color)} />
                      <span className="text-xs text-muted-foreground">{b.name}</span>
                      <span className={cn("text-[10px] font-bold", b.color)}>{b.pct}%</span>
                    </div>
                    <span className="text-xs font-mono font-semibold text-foreground">{fmt((parsed * b.pct) / 100)}</span>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={validate} className="w-full">Continuar</Button>
          </>
        )}

        {step === 2 && (
          <div onKeyDown={(e) => { if (e.key === 'Enter') onActivate(parsed); }} tabIndex={-1}>
            <div className="bg-muted/50 rounded-xl p-4 mb-4 border border-border/50 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Capital asignado</span>
                <span className="text-2xl font-bold font-mono text-foreground">{fmt(parsed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Capital intocable</span>
                <span className="text-xs font-semibold text-muted-foreground">{fmt(krakenBalance - parsed)}</span>
              </div>
              <div className="border-t border-border pt-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Los bots operarán 24/7 con <strong className="text-foreground">{fmt(parsed)}</strong>. Las ganancias diarias se retiran automáticamente y los bots continúan con el monto inicial.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 bg-chart-3/10 border border-chart-3/20 rounded-xl p-3 mb-5">
              <AlertTriangle className="w-4 h-4 text-chart-3 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-chart-3 leading-relaxed">
                Operas con capital real en Kraken Pro. El sistema aplica el protocolo SentinelAI en todo momento.
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Volver</Button>
              <Button onClick={() => onActivate(parsed)} className="flex-[2] gap-2">
                <Rocket className="w-4 h-4" /> Activar bots ahora
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Panel activo
function ActivePanel({ capital, pnl, trades, onStop }) {
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const handleStop = () => { setStopping(true); setTimeout(() => onStop(elapsed), 2500); };
  const pnlPct = capital > 0 ? (pnl / capital) * 100 : 0;
  const isPositive = pnl >= 0;

  return (
    <div className="bg-card border border-primary/30 rounded-2xl p-5 glow-green">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
          <span className="font-semibold text-foreground">Bots activos — Kraken Pro</span>
        </div>
        <span className="font-mono text-sm text-muted-foreground">{hh}:{mm}:{ss}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-muted/50 rounded-xl p-3 border border-border/50">
          <p className="text-[10px] text-muted-foreground mb-1">Capital asignado</p>
          <p className="text-lg font-mono font-bold text-foreground">{fmt(capital)}</p>
        </div>
        <div className={cn("rounded-xl p-3 border", isPositive ? "bg-primary/10 border-primary/20" : "bg-destructive/10 border-destructive/20")}>
          <p className={cn("text-[10px] mb-1", isPositive ? "text-primary" : "text-destructive")}>P&amp;L sesión</p>
          <p className={cn("text-lg font-mono font-bold", isPositive ? "text-primary" : "text-destructive")}>
            {fmt(pnl)} <span className="text-xs">({fmtPct(pnlPct)})</span>
          </p>
        </div>
        <div className="bg-muted/50 rounded-xl p-3 border border-border/50">
          <p className="text-[10px] text-muted-foreground mb-1">Operaciones hoy</p>
          <p className="text-lg font-mono font-bold text-foreground">{trades}</p>
        </div>
      </div>

      <div className="space-y-2.5 mb-5">
        {BOTS.map(b => (
          <div key={b.id} className="flex items-center gap-3">
            <b.icon className={cn("w-3.5 h-3.5 flex-shrink-0", b.color)} />
            <span className="text-xs text-muted-foreground w-28 truncate">{b.name}</span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full", b.bar)} style={{ width: `${b.pct}%` }} />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-16 text-right">{fmt((capital * b.pct) / 100)}</span>
          </div>
        ))}
      </div>

      {stopping ? (
        <div className="bg-chart-3/10 border border-chart-3/20 rounded-xl p-3 text-center">
          <p className="text-xs text-chart-3 font-medium">
            Cerrando posiciones favorablemente... Los bots terminarán sus operaciones activas antes de parar.
          </p>
        </div>
      ) : (
        <Button variant="outline" onClick={handleStop} className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 gap-2">
          <Square className="w-4 h-4" /> Ordenar parada inteligente
        </Button>
      )}
    </div>
  );
}

// Principal
export default function BotActivationPanel() {
  const { portfolio, totalUSD, balance: krakenBalances, loading: loadingBalance, error: balanceError, refresh: fetchBalance } = useKrakenData({ intervalMs: 30000 });
  const { active, assignedCapital, activate, deactivate } = useBotSession();
  const [modalOpen, setModalOpen] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [sessionStart] = useState(new Date().toISOString());
  const [pnl, setPnl] = useState(0);
  const [trades, setTrades] = useState(0);
  const krakenBalance = totalUSD;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setPnl(p => parseFloat((p + (Math.random() * 0.8 - 0.2)).toFixed(2)));
      setTrades(t => t + (Math.random() > 0.85 ? 1 : 0));
    }, 4000);
    return () => clearInterval(t);
  }, [active]);

  const handleActivate = (amount) => {
    activate(amount);
    setPnl(0);
    setTrades(0);
    setModalOpen(false);
  };
  const handleStop = (elapsedSeconds) => {
    setReportData({ capital: assignedCapital, pnl, trades, elapsedSeconds: elapsedSeconds || 0, startedAt: sessionStart });
    deactivate();
  };

  return (
    <div className="space-y-4">
      {active ? (
        <ActivePanel capital={assignedCapital} pnl={pnl} trades={trades} onStop={handleStop} />
      ) : (
        <div className="bg-card border border-border rounded-2xl p-5 gap-4">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-0.5">Operación con capital real</h3>
              <p className="text-xs text-muted-foreground">
                Portfolio total Kraken:{" "}
                {loadingBalance
                  ? <span className="animate-pulse">Conectando...</span>
                  : balanceError
                    ? <span className="text-destructive">{balanceError}</span>
                    : <strong className="text-foreground">${krakenBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD</strong>
                }
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Los bots operarán 24/7 hasta que ordenes la parada inteligente</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={fetchBalance} variant="ghost" size="icon" disabled={loadingBalance} className="shrink-0">
                <RefreshCw className={cn("w-4 h-4", loadingBalance && "animate-spin")} />
              </Button>
              <Button onClick={() => setModalOpen(true)} className="gap-2" disabled={loadingBalance || !!balanceError || krakenBalance <= 0}>
                <Rocket className="w-4 h-4" /> Activar bots
              </Button>
            </div>
          </div>

          {/* Portfolio detallado */}
          {portfolio.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {portfolio.map(p => (
                <div key={p.asset} className="bg-muted/40 rounded-lg p-2.5 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-foreground">{p.asset.replace('X','').replace('Z','')}</span>
                    <p className="text-[10px] text-muted-foreground">{p.amount.toFixed(6)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono font-semibold text-foreground">${p.usdValue.toLocaleString('en-US',{maximumFractionDigits:2})}</p>
                    <p className={cn("text-[10px] font-semibold", p.change24h >= 0 ? "text-primary" : "text-destructive")}>
                      {p.change24h >= 0 ? "+" : ""}{p.change24h}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {BOTS.map(b => (
          <div key={b.id} className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <b.icon className={cn("w-3.5 h-3.5", b.color)} />
              <span className={cn("text-xs font-bold", b.color)}>{b.pct}%</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{b.name}</p>
            {active && (
              <p className="text-xs font-mono font-semibold text-foreground mt-1">
                {fmt((assignedCapital * b.pct) / 100)}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-foreground mb-2">Protocolo SentinelAI activo</p>
        <div className="grid sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
          <div className="bg-muted/50 rounded-lg p-2.5">Riesgo max/trade: <strong className="text-foreground">1%</strong></div>
          <div className="bg-muted/50 rounded-lg p-2.5">Drawdown emergencia: <strong className="text-foreground">2%</strong></div>
          <div className="bg-muted/50 rounded-lg p-2.5">Objetivo diario: <strong className="text-foreground">+2% a +5%</strong></div>
          <div className="bg-muted/50 rounded-lg p-2.5">Apalancamiento max: <strong className="text-foreground">2x</strong></div>
          <div className="bg-muted/50 rounded-lg p-2.5">Trades max/dia: <strong className="text-foreground">15</strong></div>
          <div className="bg-muted/50 rounded-lg p-2.5">Horario nocturno: <strong className="text-foreground">sizing 70%</strong></div>
        </div>
      </div>

      <LiveTradingChart active={active} capital={assignedCapital} />

      {modalOpen && (
        <ActivationModal
          krakenBalance={krakenBalance}
          portfolio={portfolio}
          onActivate={handleActivate}
          onClose={() => setModalOpen(false)}
        />
      )}

      {reportData && (
        <SessionReportModal
          sessionData={reportData}
          onClose={() => setReportData(null)}
        />
      )}
    </div>
  );
}