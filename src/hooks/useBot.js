import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Valores por defecto de las reglas (iguales que DEFAULTS en tradingLoop)
export const RISK_DEFAULTS = {
  mode: "paper", paper_capital_eur: 50, kill_switch: false,
  max_open_trades: 1, max_loss_per_trade_eur: 0.5, max_daily_loss_eur: 1.5, max_trades_per_day: 3, max_order_eur: 45,
  min_reward_risk: 1.5, max_hold_minutes: 240,
  cooldown_after_stop_minutes: 60, stoploss_guard_limit: 2, max_drawdown_pct: 10,
  session_anchor_utc_hour: 7, entry_window_utc_start: "07:15", entry_window_utc_end: "19:00",
  target_r: 3, tm_min_edge_points: 5,
};

const rowsOf = data => (Array.isArray(data) ? data : data?.items || []);
export const parseJson = value => { try { return typeof value === "string" ? JSON.parse(value || "{}") : (value || {}); } catch { return {}; } };

export const eur = (value, digits = 2) => `${Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
export const signedEur = (value, digits = 2) => `${Number(value || 0) >= 0 ? "+" : ""}${eur(value, digits)}`;
export const pct = (value, digits = 2) => `${Number(value || 0) >= 0 ? "+" : ""}${Number(value || 0).toFixed(digits)} %`;
export const fmtPair = (pair = "") => { const p = String(pair).toUpperCase(); if (p.includes("/")) return p; const base = p.replace(/EUR$/, ""); return `${base === "XBT" ? "BTC" : base}/EUR`; };
export const EXIT_LABELS = { stop: "Stop-loss", target: "Objetivo", time: "Tiempo máximo", manual: "Manual", safety: "Seguridad" };

export function useBot() {
  const queryClient = useQueryClient();
  const { data: sessions = [] } = useQuery({
    queryKey: ["bot-sessions"],
    queryFn: async () => rowsOf(await base44.entities.BotSession.list("-created_date", 1)),
    refetchInterval: 10000,
  });
  const { data: riskRows = [] } = useQuery({
    queryKey: ["risk-config"],
    queryFn: async () => rowsOf(await base44.entities.RiskConfig.list("-created_date", 1)),
    refetchInterval: 30000,
  });
  const session = sessions[0] || null;
  const running = !!session?.active;
  const record = riskRows[0] || null;
  const config = { ...RISK_DEFAULTS, ...Object.fromEntries(Object.entries(record || {}).filter(([, v]) => v !== null && v !== undefined && v !== "")) };
  const tradeMode = session ? (session.mode === "live" ? "live" : "demo") : config.mode === "live" ? "live" : "demo";

  const { data: trades = [] } = useQuery({
    queryKey: ["bot-trades", tradeMode],
    queryFn: async () => rowsOf(await base44.entities.Trade.filter({ mode: tradeMode }, "-created_date", 200)),
    refetchInterval: 15000,
  });
  const sessionStart = session ? new Date(session.started_at || session.created_date).getTime() : 0;
  const sessionTrades = session ? trades.filter(t => t.session_id === session.id || (!t.session_id && new Date(t.entry_date || t.created_date).getTime() >= sessionStart)) : [];

  const refresh = () => queryClient.invalidateQueries();
  const invoke = async (name, payload = {}) => {
    const res = await base44.functions.invoke(name, payload);
    const data = res?.data ?? res;
    if (data?.ok === false || data?.error) throw new Error(data.error || "La operación ha fallado");
    refresh();
    return data;
  };

  const saveConfig = async values => {
    const payload = { ...values };
    delete payload.id; delete payload.created_date; delete payload.updated_date; delete payload.created_by; delete payload.created_by_id;
    if (record?.id) await base44.entities.RiskConfig.update(record.id, payload);
    else await base44.entities.RiskConfig.create(payload);
    refresh();
  };

  return {
    session, running, mode: session ? (session.mode === "live" ? "live" : "paper") : config.mode,
    config, saveConfig, trades, sessionTrades, summary: parseJson(session?.last_cycle_summary),
    start: () => invoke("startLiveBots"),
    stop: closeOpenTrades => invoke("stopLiveBots", { closeOpenTrades }),
    closeTrade: id => invoke("tradingLoop", { closeTradeId: id }),
    runCycle: () => invoke("tradingLoop", { runOnce: true }),
    refresh,
  };
}
