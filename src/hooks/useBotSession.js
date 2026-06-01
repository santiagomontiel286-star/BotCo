/**
 * Persists bot activation state — DB (BotSession entity) + sessionStorage fallback.
 * Hydrates from DB on mount so the session survives browser close.
 */
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";

const KEY = "botco_bot_session";

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export default function useBotSession() {
  const saved = load();
  const [active, setActive] = useState(saved?.active || false);
  const [assignedCapital, setAssignedCapital] = useState(saved?.assignedCapital || 0);
  const [initialBalance, setInitialBalance] = useState(saved?.initialBalance || 0);
  const [sessionMode, setSessionMode] = useState(saved?.mode || "real");
  const [startedAt, setStartedAt] = useState(saved?.startedAt || null);

  // Hydrate from DB on mount — recovers state after browser close
  useEffect(() => {
    base44.entities.BotSession.filter({ active: true }).then(sessions => {
      if (sessions?.length > 0) {
        const s = sessions[0];
        setActive(true);
        setAssignedCapital(s.assigned_capital || 0);
        setSessionMode(s.mode || "real");
        setStartedAt(new Date(s.started_at || s.created_date).getTime());
        if (s.mode !== "live") {
          const prev = load();
          sessionStorage.setItem(KEY, JSON.stringify({
            active: true,
            assignedCapital: s.assigned_capital,
            startedAt: new Date(s.started_at || s.created_date).getTime(),
            initialBalance: prev?.initialBalance || s.assigned_capital || 0,
            mode: s.mode || "real",
          }));
        }
      }
    }).catch(() => {});
  }, []);

  const activate = async (amount, krakenBalance = 0, mode = "real") => {
    const savedProfile = localStorage.getItem("botco_risk_profile") || "conservador";
    const session = { active: true, assignedCapital: amount, startedAt: Date.now(), initialBalance: krakenBalance, mode };
    if (mode !== "live") sessionStorage.setItem(KEY, JSON.stringify(session));
    setActive(true);
    setAssignedCapital(amount);
    setInitialBalance(krakenBalance);
    setSessionMode(mode);
    setStartedAt(session.startedAt);
    try {
      const existing = await base44.entities.BotSession.filter({ active: true });
      for (const s of existing) await base44.entities.BotSession.update(s.id, { active: false });
      await base44.entities.BotSession.create({
        active: true,
        assigned_capital: amount,
        started_at: new Date().toISOString(),
        mode: mode,
        risk_profile: savedProfile,
        total_trades: 0,
        total_pnl: 0,
      });
    } catch (e) {
      console.error("BotSession create failed:", e);
    }
  };

  const deactivate = async () => {
    sessionStorage.removeItem(KEY);
    setActive(false);
    setAssignedCapital(0);
    setStartedAt(null);
    // Stop backend engine
    try {
      const existing = await base44.entities.BotSession.filter({ active: true });
      for (const s of existing) await base44.entities.BotSession.update(s.id, { active: false });
    } catch (e) {
      console.error("BotSession deactivate failed:", e);
    }
  };

  return { active, assignedCapital, initialBalance, sessionMode, startedAt, activate, deactivate };
}