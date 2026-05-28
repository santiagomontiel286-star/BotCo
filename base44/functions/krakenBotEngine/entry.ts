/**
 * BotCo Real Trading Engine
 * - Runs every 5 minutes via automation
 * - Checks active BotSession
 * - Computes signals (EMA crossover, RSI, momentum)
 * - Places real market orders on Kraken
 * - Records trades to Trade entity
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = "https://api.kraken.com";
const PAIRS = ["XBTEUR", "ETHEUR", "SOLEUR", "XRPEUR"];
const PAIR_LABELS = { XBTEUR: "BTC/EUR", ETHEUR: "ETH/EUR", SOLEUR: "SOL/EUR", XRPEUR: "XRP/EUR" };

// Min order volumes for each pair (Kraken limits)
const MIN_VOL = { XBTEUR: 0.0002, ETHEUR: 0.005, SOLEUR: 0.5, XRPEUR: 10 };

// Bot allocations
const BOTS = [
  { id: "trend",  name: "Trend Follower",  pct: 35, strategy: "trend" },
  { id: "mean",   name: "Mean Reversion",  pct: 25, strategy: "rsi" },
  { id: "ai",     name: "AI Sentiment",    pct: 25, strategy: "momentum" },
  { id: "risk",   name: "Risk Guardian",   pct: 15, strategy: "breakout" },
];

// ── Nonce counter (strictly increasing within one execution) ─────────────────
let _nonceBase = Date.now() * 1000;
let _nonceSeq = 0;
function nextNonce() {
  return (_nonceBase + _nonceSeq++).toString();
}

// ── Kraken signing ────────────────────────────────────────────────────────────
async function krakenSign(path, nonce, postData, apiSecret) {
  const enc = new TextEncoder();
  const msgHash = await crypto.subtle.digest("SHA-256", enc.encode(nonce + postData));
  const secretBytes = Uint8Array.from(atob(apiSecret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const pathBytes = enc.encode(path);
  const combined = new Uint8Array(pathBytes.length + msgHash.byteLength);
  combined.set(pathBytes, 0);
  combined.set(new Uint8Array(msgHash), pathBytes.length);
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

// ── Technical Indicators ──────────────────────────────────────────────────────
function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcEMASeries(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  const series = [ema];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    series.push(ema);
  }
  return series;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── Signal Logic ──────────────────────────────────────────────────────────────
function getSignal(strategy, closes) {
  const n = closes.length;
  if (n < 22) return "hold";

  if (strategy === "trend") {
    // EMA9 / EMA21 crossover
    const ema9 = calcEMASeries(closes, 9);
    const ema21 = calcEMASeries(closes, 21);
    const last = n - 1;
    const prev = n - 2;
    if (ema9[prev] < ema21[prev] && ema9[last] > ema21[last]) return "buy";
    if (ema9[prev] > ema21[prev] && ema9[last] < ema21[last]) return "sell";
    return "hold";
  }

  if (strategy === "rsi") {
    const rsi = calcRSI(closes, 14);
    if (rsi < 32) return "buy";
    if (rsi > 68) return "sell";
    return "hold";
  }

  if (strategy === "momentum") {
    // Last 3 candles all bullish or all bearish
    const last3 = closes.slice(-4);
    const bull = last3[1] > last3[0] && last3[2] > last3[1] && last3[3] > last3[2];
    const bear = last3[1] < last3[0] && last3[2] < last3[1] && last3[3] < last3[2];
    if (bull) return "buy";
    if (bear) return "sell";
    return "hold";
  }

  if (strategy === "breakout") {
    // Price breaks 20-period high/low
    const last = closes[n - 1];
    const window = closes.slice(-21, -1);
    const high20 = Math.max(...window);
    const low20 = Math.min(...window);
    if (last > high20) return "buy";
    if (last < low20) return "sell";
    return "hold";
  }

  return "hold";
}

// ── Kraken pair name mapping ──────────────────────────────────────────────────
const OHLC_PAIR = { XBTEUR: "XBTEUR", ETHEUR: "ETHEUR", SOLEUR: "SOLEUR", XRPEUR: "XRPEUR" };

async function getCloses(pair) {
  const data = await krakenPublic("OHLC", { pair: OHLC_PAIR[pair], interval: 5 });
  if (data.error?.length) return null;
  const key = Object.keys(data.result).find(k => k !== "last");
  if (!key) return null;
  return data.result[key].map(c => parseFloat(c[4])); // close price
}

async function getLastPrice(pair) {
  const data = await krakenPublic("Ticker", { pair });
  if (data.error?.length) return null;
  const key = Object.keys(data.result)[0];
  return parseFloat(data.result[key].c[0]);
}

// ── Open positions check ──────────────────────────────────────────────────────
async function getOpenPositions(apiKey, apiSecret) {
  const data = await krakenPrivate("OpenPositions", {}, apiKey, apiSecret);
  if (data.error?.length) return {};
  return data.result || {};
}

async function getOpenOrders(apiKey, apiSecret) {
  const data = await krakenPrivate("OpenOrders", {}, apiKey, apiSecret);
  if (data.error?.length) return {};
  return data.result?.open || {};
}

// ── Place order ───────────────────────────────────────────────────────────────
async function placeOrder(pair, side, volume, apiKey, apiSecret) {
  const params = {
    pair,
    type: side,       // "buy" or "sell"
    ordertype: "market",
    volume: volume.toString(),
  };
  const data = await krakenPrivate("AddOrder", params, apiKey, apiSecret);
  return data;
}

// ── Main engine ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow automation (no user) OR admin user
    let isAdmin = false;
    try {
      const user = await base44.auth.me();
      isAdmin = user?.role === "admin";
    } catch {
      // Called from automation — proceed
      isAdmin = true;
    }
    if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

    const apiKey = Deno.env.get("KRAKEN_API_KEY");
    const apiSecret = Deno.env.get("KRAKEN_API_SECRET");
    if (!apiKey || !apiSecret) return Response.json({ error: "Kraken API keys not configured" }, { status: 500 });

    // Check active session
    const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true });
    if (!sessions || sessions.length === 0) {
      return Response.json({ status: "idle", message: "No active bot session" });
    }
    const session = sessions[0];
    const capital = session.assigned_capital || 0;
    if (capital < 10) return Response.json({ status: "skip", message: "Capital too low" });

    const results = [];
    let sessionPnlDelta = 0;
    let sessionTradesDelta = 0;

    // Get open orders to avoid spam
    const openOrders = await getOpenOrders(apiKey, apiSecret);
    const openPairs = new Set(Object.values(openOrders).map(o => o.descr?.pair));

    // Get open trades per bot to avoid double-buying
    const openTrades = await base44.asServiceRole.entities.Trade.filter({ status: "open" });
    const openBotPairs = new Set(openTrades.map(t => `${t.bot_name}::${t.pair}`));

    for (const pair of PAIRS) {
      const closes = await getCloses(pair);
      if (!closes || closes.length < 25) {
        results.push({ pair, status: "skip", reason: "insufficient data" });
        continue;
      }

      const currentPrice = closes[closes.length - 1];
      if (!currentPrice) continue;

      // Skip if already have open order for this pair
      if (openPairs.has(pair)) {
        results.push({ pair, status: "skip", reason: "open order exists" });
        continue;
      }

      for (const bot of BOTS) {
        const botCapital = (capital * bot.pct) / 100;
        // Use full bot capital per trade (one active trade per bot at a time)
        const tradeCapital = botCapital;
        const minVol = MIN_VOL[pair];
        const rawVolume = tradeCapital / currentPrice;

        if (rawVolume < minVol) {
          results.push({ pair, bot: bot.name, status: "skip", reason: `need $${(minVol * currentPrice).toFixed(2)} min, have $${tradeCapital.toFixed(2)}` });
          continue;
        }

        // Round to 6 decimal places for the order
        const volume = Math.floor(rawVolume * 1e6) / 1e6;

        // Skip if this bot already has an open trade on this pair
        const botPairKey = `${bot.name}::${PAIR_LABELS[pair] || pair}`;
        if (openBotPairs.has(botPairKey)) {
          results.push({ pair, bot: bot.name, status: "skip", reason: "open trade exists" });
          continue;
        }

        const signal = getSignal(bot.strategy, closes);
        if (signal === "hold") {
          results.push({ pair, bot: bot.name, status: "hold" });
          continue;
        }

        // Place real order
        const orderResult = await placeOrder(pair, signal, volume, apiKey, apiSecret);
        const txids = orderResult.result?.txid || [];
        const hasError = orderResult.error?.length > 0;

        if (!hasError && txids.length > 0) {
          sessionTradesDelta++;
          // Record to Trade entity
          await base44.asServiceRole.entities.Trade.create({
            bot_name: bot.name,
            pair: PAIR_LABELS[pair] || pair,
            side: signal,
            entry_price: currentPrice,
            amount: volume,
            status: "open",
            entry_date: new Date().toISOString(),
            notes: `Strategy: ${bot.strategy} | TxID: ${txids.join(",")}`,
          });
          results.push({ pair, bot: bot.name, signal, volume, txid: txids[0], status: "executed" });
        } else {
          results.push({ pair, bot: bot.name, signal, status: "error", error: orderResult.error?.[0] || "unknown" });
        }
      }
    }

    // Update session stats
    if (sessionTradesDelta > 0) {
      await base44.asServiceRole.entities.BotSession.update(session.id, {
        total_trades: (session.total_trades || 0) + sessionTradesDelta,
      });
    }

    return Response.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      session_id: session.id,
      capital,
      results,
      trades_executed: sessionTradesDelta,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});