import { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Shared hook — fetches ALL Kraken data (portfolio, open orders, trades)
 * and keeps it refreshed automatically.
 *
 * Usage:
 *   const { portfolio, totalUSD, balance, openOrders, trades, loading, error, refresh } = useKrakenData();
 */
export default function useKrakenData({ intervalMs = 30000 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      // Read user-provided keys from sessionStorage (set in Settings page)
      let extraParams = {};
      try {
        const saved = JSON.parse(sessionStorage.getItem('botco_api_keys') || 'null');
        if (saved?.krakenKey && saved?.krakenSecret) {
          extraParams = { apiKey: saved.krakenKey, apiSecret: saved.krakenSecret };
        }
      } catch {}
      const res = await base44.functions.invoke('krakenAccount', extraParams);
      if (res.data?.portfolio) {
        setData(res.data);
      } else {
        setError(res.data?.error || "Sin datos de Kraken");
      }
    } catch (e) {
      setError("No se pudo conectar con Kraken");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(false);
    timerRef.current = setInterval(() => refresh(true), intervalMs);
    return () => clearInterval(timerRef.current);
  }, [refresh, intervalMs]);

  return {
    portfolio: data?.portfolio || [],
    totalUSD: data?.totalUSD || 0,
    balance: data?.balance || {},
    openOrders: data?.openOrders || [],
    trades: data?.trades || [],
    fetchedAt: data?.fetchedAt || null,
    loading,
    error,
    refresh: () => refresh(false),
  };
}