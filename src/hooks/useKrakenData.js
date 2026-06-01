import { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";

const CACHE_TTL_MS = 60000;
const subscribers = new Set();
let sharedData = null;
let sharedError = null;
let sharedLoading = false;
let sharedFetchedAt = 0;
let sharedPromise = null;

function notify() {
  subscribers.forEach(listener => listener({ data: sharedData, error: sharedError, loading: sharedLoading }));
}

function getSessionKeys() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('botco_api_keys') || 'null');
    if (saved?.krakenKey && saved?.krakenSecret) return { apiKey: saved.krakenKey, apiSecret: saved.krakenSecret };
  } catch {}
  return {};
}

async function fetchSharedKraken(force = false) {
  if (!force && sharedData && Date.now() - sharedFetchedAt < CACHE_TTL_MS) return sharedData;
  if (sharedPromise) return sharedPromise;

  sharedLoading = true;
  sharedError = null;
  notify();

  sharedPromise = base44.functions.invoke('krakenAccount', getSessionKeys())
    .then(res => {
      if (res.data?.portfolio) {
        sharedData = res.data;
        sharedFetchedAt = Date.now();
      } else {
        sharedError = res.data?.error || "Sin datos de Kraken";
      }
      return sharedData;
    })
    .catch(() => {
      sharedError = "No se pudo conectar con Kraken";
      return sharedData;
    })
    .finally(() => {
      sharedLoading = false;
      sharedPromise = null;
      notify();
    });

  return sharedPromise;
}

export default function useKrakenData({ intervalMs = 60000 } = {}) {
  const safeInterval = Math.max(intervalMs, CACHE_TTL_MS);
  const [state, setState] = useState({ data: sharedData, error: sharedError, loading: !sharedData });
  const timerRef = useRef(null);

  const refresh = useCallback(async (force = false) => {
    await fetchSharedKraken(force);
  }, []);

  useEffect(() => {
    subscribers.add(setState);
    refresh(false);
    timerRef.current = setInterval(() => refresh(false), safeInterval);
    return () => {
      subscribers.delete(setState);
      clearInterval(timerRef.current);
    };
  }, [refresh, safeInterval]);

  const data = state.data;
  return {
    portfolio: data?.portfolio || [],
    totalUSD: data?.totalUSD || 0,
    balance: data?.balance || {},
    openOrders: data?.openOrders || [],
    trades: data?.trades || [],
    fetchedAt: data?.fetchedAt || null,
    loading: state.loading,
    error: state.error,
    refresh: () => refresh(true),
  };
}