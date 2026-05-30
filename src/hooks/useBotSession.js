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

  // Hydrate from DB on mount — recovers state after browser close
  useEffect(() => {
    base44.entities.BotSession.filter({ active: true }).then(sessions => {
      if (sessions?.length > 0) {
        const s = sessions[0];
        setActive(true);
        setAssignedCapital(s.assigned_capital || 0);
        const prev = load();
        sessionStorage.setItem(KEY, JSON.stringify({
          active: true,
          assignedCapital: s.assigned_capital,
          startedAt: prev?.startedAt || new Date(s.started_at).getTime(),
          initialBalance: prev?.initialBalance || 0,
        }));
      }
    }).catch(() => {});
  }, []);

  const activate = async (amount, krakenBalance = 0, mode = "real") => {
    const savedProfile = localStorage.getItem("botco_risk_profile") || "conservador";
    const session = { active: true, assignedCapital: amount, startedAt: Date.now(), initialBalance: krakenBalance, mode };
    sessionStorage.setItem(KEY, JSON.stringify(session));
    setActive(true);
    setAssignedCapital(amount);
    setInitialBalance(krakenBalance);
    setSessionMode(mode);
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
    // Stop backend engine
    try {
      const existing = await base44.entities.BotSession.filter({ active: true });
      for (const s of existing) await base44.entities.BotSession.update(s.id, { active: false });
    } catch (e) {
      console.error("BotSession deactivate failed:", e);
    }
  };

  return { active, assignedCapital, initialBalance, sessionMode, activate, deactivate };
}