/**
 * Persists bot activation state in sessionStorage so it survives navigation.
 */
import { useState } from "react";

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

  const activate = (amount) => {
    const session = { active: true, assignedCapital: amount, startedAt: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(session));
    setActive(true);
    setAssignedCapital(amount);
  };

  const deactivate = () => {
    sessionStorage.removeItem(KEY);
    setActive(false);
    setAssignedCapital(0);
  };

  return { active, assignedCapital, activate, deactivate };
}