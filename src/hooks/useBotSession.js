/**
 * Persists bot activation state — sessionStorage (UI) + BotSession entity (backend engine).
 */
import { useState } from "react";
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

  const activate = async (amount, krakenBalance = 0) => {
    const session = { active: true, assignedCapital: amount, startedAt: Date.now(), initialBalance: krakenBalance };
    sessionStorage.setItem(KEY, JSON.stringify(session));
    setActive(true);
    setAssignedCapital(amount);
    setInitialBalance(krakenBalance);
    // Create backend session so the engine can trade
    try {
      // Clear any stale sessions first
      const existing = await base44.entities.BotSession.filter({ active: true });
      for (const s of existing) await base44.entities.BotSession.update(s.id, { active: false });
      await base44.entities.BotSession.create({
        active: true,
        assigned_capital: amount,
        started_at: new Date().toISOString(),
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

  return { active, assignedCapital, initialBalance, activate, deactivate };
}