/**
 * BotCo Real Trading Engine — Single Position Strategy
 * Designed for small accounts: one trade at a time, full available capital.
 * Runs every 5 minutes via automation.
 * - Closes open trade if TP/SL hit or stale
 * - If no open trade, finds best signal and places one order with full capital
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = "https://api.kraken.com";

// Only pairs viable with small accounts (low minimum order value)
const PAIRS = ["XBTEUR", "ETHEUR"];
const PAIR_LABELS = { XBTEUR: "BTC/EUR", ETHEUR: "ETH/EUR" };

// Kraken minimum volumes
const MIN_VOL = { XBTEUR: 0.0002, ETHEUR: 0.002 };

// Risk params
const TP_PCT   = 0.025;   // 2.5% take profit
const SL_PCT   = 0.012;   // 1.2% stop loss
const MAX_HOURS = 4;      // force-close after 4 hours

const STRATEGIES = [
  { name: "Trend Follower", strategy: "trend" },
  { name: "Mean Reversion", strategy: "rsi" },
  { name: "AI Sentiment",   strategy: "momentum" },
  { name: "Risk Guardian",  strategy: "breakout" },
];

let _nonce = Date.now() * 1000;
function nextNonce() { return (++_nonce).toString(); }

async function krakenSign(path, nonce, postData, apiSecret) {
  const enc = new TextEncoder();
  const msgHash = await crypto.subtle.digest("SHA-256", enc.encode(nonce + postData));
  const secretBytes = Uint8Array.from(atob(apiSecret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const combined = new Uint8Array(enc.encode(path).length + msgHash.byteLength);
  combined.set(enc.encode(path), 0);
  combined.set(new Uint8Array(msgHash), enc.encode(path).length);
  const sig = await crypto.subtle.sign("HMAC", key, combined);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function krakenPrivate(endpoint, params, apiKey, apiSecret) {
  const nonce = nextNonce();
  const body = new URLSearchParams({ nonce, ...params }).toString();
  const path = `/0/private/${endpoint}`;
  const signature = await krakenSign(path, nonce, body, apiSecret);
  const res = await fetch(`${KRAKEN_API}${path}`, {
    method: "POST",
    headers: { "API-Key": apiKey, "API-Sign": signature, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return res.json();
}

async function krakenPublic(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${KRAKEN_API}/0/public/${endpoint}${qs ? "?" + qs : ""}`);
  return res.json();
}

async function getCloses(pair) {
  const data = await krakenPublic("OHLC", { pair, interval: 5 });
  if (data.error?.length) return null;
  const key = Object.keys(data.result).find(k => k !== "last");
  return key ? data.result[key].map(c => parseFloat(c[4])) : null;
}

async function getLastPrice(pair) {
  const data = await krakenPublic("Ticker", { pair });
  if (data.error?.length) return null;
  const key = Object.keys(data.result)[0];
  return parseFloat(data.result[key].c[0]);
}

function calcEMASeries(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  return prices.map((p, i) => (i === 0 ? ema : (ema = p * k + ema * (1 - k))));
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(0, d)) / period;
    al = (al * (period - 1) + Math.max(0, -d)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function getSignal(strategy, closes) {
  const n = closes.length;
  if (n < 22) return "hold";
  if (strategy === "trend") {
    const e9 = calcEMASeries(closes, 9), e21 = calcEMASeries(closes, 21);
    if (e9[n-2] < e21[n-2] && e9[n-1] > e21[n-1]) return "buy";
    if (e9[n-2] > e21[n-2] && e9[n-1] < e21[n-1]) return "sell";
  }
  if (strategy === "rsi") {
    const rsi = calcRSI(closes, 14);
    if (rsi < 32) return "buy";
    if (rsi > 68) return "sell";
  }
  if (strategy === "momentum") {
    const s = closes.slice(-4);
    if (s[1]>s[0] && s[2]>s[1] && s[3]>s[2]) return "buy";
    if (s[1]<s[0] && s[2]<s[1] && s[3]<s[2]) return "sell";
  }
  if (strategy === "breakout") {
    const last = closes[n-1];
    const window = closes.slice(-21, -1);
    if (last > Math.max(...window)) return "buy";
    if (last < Math.min(...window)) return "sell";
  }
  return "hold";
}

async function placeOrder(pair, side, volume, apiKey, apiSecret) {
  return krakenPrivate("AddOrder", { pair, type: side, ordertype: "market", volume: volume.toString() }, apiKey, apiSecret);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth check (allow automation calls)
    try {
      const user = await base44.auth.me();
      if (user && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    } catch { /* automation — no user token */ }

    const apiKey = Deno.env.get("KRAKEN_API_KEY");
    const apiSecret = Deno.env.get("KRAKEN_API_SECRET");
    if (!apiKey || !apiSecret) return Response.json({ error: "Kraken API keys not configured" }, { status: 500 });

    // Check active session
    const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true });
    if (!sessions?.length) return Response.json({ status: "idle", message: "No active bot session" });

    const session = sessions[0];
    const capital = session.assigned_capital || 0;
    if (capital < 5) return Response.json({ status: "skip", message: "Capital too low" });

    const log = [];

    // ── Step 1: Manage open trade ─────────────────────────────────────────────
    const openTrades = await base44.asServiceRole.entities.Trade.filter({ status: "open" });
    let hasOpenTrade = openTrades.length > 0;

    for (const trade of openTrades) {
      const krakenPair = Object.keys(PAIR_LABELS).find(k => PAIR_LABELS[k] === trade.pair);
      if (!krakenPair) {
        await base44.asServiceRole.entities.Trade.update(trade.id, { status: "closed", exit_date: new Date().toISOString() });
        hasOpenTrade = false;
        continue;
      }

      const price = await getLastPrice(krakenPair);
      if (!price) continue;

      const ageHours = (Date.now() - new Date(trade.entry_date || trade.created_date).getTime()) / 3600000;
      const isLong = trade.side === "buy";
      const pricePct = (price - trade.entry_price) / trade.entry_price;
      const hitTP = isLong ? pricePct >= TP_PCT : pricePct <= -TP_PCT;
      const hitSL = isLong ? pricePct <= -SL_PCT : pricePct >= SL_PCT;

      if (hitTP || hitSL || ageHours >= MAX_HOURS) {
        const reason = hitTP ? "take_profit" : hitSL ? "stop_loss" : "timeout";
        const closeType = isLong ? "sell" : "buy";
        const minVol = MIN_VOL[krakenPair] || 0;
        let closedOk = false;
        if (trade.amount >= minVol) {
          const res = await placeOrder(krakenPair, closeType, trade.amount, apiKey, apiSecret);
          closedOk = !res.error?.length;
        }
        const pnl = isLong
          ? (price - trade.entry_price) * trade.amount
          : (trade.entry_price - price) * trade.amount;
        await base44.asServiceRole.entities.Trade.update(trade.id, {
          status: "closed",
          exit_price: price,
          exit_date: new Date().toISOString(),
          profit_loss: parseFloat(pnl.toFixed(4)),
          profit_loss_percent: parseFloat((pricePct * 100 * (isLong ? 1 : -1)).toFixed(2)),
          notes: `Closed: ${reason}${closedOk ? " (order placed)" : " (amount too small, no close order)"}`,
        });
        await base44.asServiceRole.entities.BotSession.update(session.id, {
          total_trades: (session.total_trades || 0) + 1,
          total_pnl: parseFloat(((session.total_pnl || 0) + pnl).toFixed(4)),
        });
        hasOpenTrade = false;
        log.push({ action: "closed", pair: trade.pair, reason, pnl: pnl.toFixed(4) });
      }
    }

    // ── Step 2: Open new trade if none active ─────────────────────────────────
    if (hasOpenTrade) {
      return Response.json({ status: "ok", message: "Trade already open — waiting", log });
    }

    // Scan all pairs and strategies for first actionable signal
    for (const pair of PAIRS) {
      const closes = await getCloses(pair);
      if (!closes || closes.length < 25) continue;

      const price = closes[closes.length - 1];
      const minVol = MIN_VOL[pair];
      const rawVolume = capital / price;

      if (rawVolume < minVol) {
        log.push({ pair, status: "skip", reason: `need €${(minVol * price).toFixed(2)}, have €${capital.toFixed(2)}` });
        continue;
      }

      const volume = Math.floor(rawVolume * 1e5) / 1e5; // 5 decimals precision

      for (const bot of STRATEGIES) {
        const signal = getSignal(bot.strategy, closes);
        if (signal === "hold") continue;

        const result = await placeOrder(pair, signal, volume, apiKey, apiSecret);
        if (result.error?.length) {
          log.push({ pair, bot: bot.name, signal, status: "error", error: result.error[0] });
          continue;
        }

        const txids = result.result?.txid || [];
        const isLong = signal === "buy";
        await base44.asServiceRole.entities.Trade.create({
          bot_name: bot.name,
          pair: PAIR_LABELS[pair],
          side: signal,
          entry_price: price,
          amount: volume,
          status: "open",
          take_profit: parseFloat((price * (isLong ? 1 + TP_PCT : 1 - TP_PCT)).toFixed(2)),
          stop_loss: parseFloat((price * (isLong ? 1 - SL_PCT : 1 + SL_PCT)).toFixed(2)),
          entry_date: new Date().toISOString(),
          notes: `Strategy: ${bot.strategy} | Capital: €${capital.toFixed(2)} | TxID: ${txids.join(",")}`,
        });

        log.push({ pair: PAIR_LABELS[pair], bot: bot.name, signal, volume, price, txid: txids[0], status: "executed" });

        // One trade at a time — stop scanning
        return Response.json({ status: "ok", timestamp: new Date().toISOString(), action: "new_trade", log });
      }
    }

    return Response.json({ status: "ok", timestamp: new Date().toISOString(), action: "hold", log });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});