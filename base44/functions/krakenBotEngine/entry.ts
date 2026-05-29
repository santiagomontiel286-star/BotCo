/**
 * BotCo Real Trading Engine
 * - Runs every 5 minutes via automation
 * - Closes open trades that hit TP/SL or are older than MAX_TRADE_HOURS
 * - Computes signals (EMA crossover, RSI, momentum, breakout)
 * - Places real market orders on Kraken
 * - Records trades to Trade entity
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = "https://api.kraken.com";
const PAIRS = ["XBTEUR", "ETHEUR", "SOLEUR", "XRPEUR"];
const PAIR_LABELS = { XBTEUR: "BTC/EUR", ETHEUR: "ETH/EUR", SOLEUR: "SOL/EUR", XRPEUR: "XRP/EUR" };
const LABEL_TO_PAIR = { "BTC/EUR": "XBTEUR", "ETH/EUR": "ETHEUR", "SOL/EUR": "SOLEUR", "XRP/EUR": "XRPEUR" };

const MIN_VOL = { XBTEUR: 0.0002, ETHEUR: 0.005, SOLEUR: 0.5, XRPEUR: 10 };

// Risk params
const TP_PCT = 0.025;       // 2.5% take profit
const SL_PCT = 0.012;       // 1.2% stop loss
const MAX_TRADE_HOURS = 3;  // force-close after 3 hours

const BOTS = [
  { id: "trend",  name: "Trend Follower",  pct: 35, strategy: "trend" },
  { id: "mean",   name: "Mean Reversion",  pct: 25, strategy: "rsi" },
  { id: "ai",     name: "AI Sentiment",    pct: 25, strategy: "momentum" },
  { id: "risk",   name: "Risk Guardian",   pct: 15, strategy: "breakout" },
];

let _nonceBase = Date.now() * 1000;
let _nonceSeq = 0;
function nextNonce() {
  return (_nonceBase + _nonceSeq++).toString();
}

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
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function getSignal(strategy, closes) {
  const n = closes.length;
  if (n < 22) return "hold";

  if (strategy === "trend") {
    const ema9 = calcEMASeries(closes, 9);
    const ema21 = calcEMASeries(closes, 21);
    const last = n - 1, prev = n - 2;
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
    const last3 = closes.slice(-4);
    const bull = last3[1] > last3[0] && last3[2] > last3[1] && last3[3] > last3[2];
    const bear = last3[1] < last3[0] && last3[2] < last3[1] && last3[3] < last3[2];
    if (bull) return "buy";
    if (bear) return "sell";
    return "hold";
  }
  if (strategy === "breakout") {
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

async function getCloses(pair) {
  const data = await krakenPublic("OHLC", { pair, interval: 5 });
  if (data.error?.length) return null;
  const key = Object.keys(data.result).find(k => k !== "last");
  if (!key) return null;
  return data.result[key].map(c => parseFloat(c[4]));
}

async function getLastPrice(pair) {
  const data = await krakenPublic("Ticker", { pair });
  if (data.error?.length) return null;
  const key = Object.keys(data.result)[0];
  return parseFloat(data.result[key].c[0]);
}

async function getOpenOrders(apiKey, apiSecret) {
  const data = await krakenPrivate("OpenOrders", {}, apiKey, apiSecret);
  if (data.error?.length) return {};
  return data.result?.open || {};
}

async function placeOrder(pair, side, volume, apiKey, apiSecret) {
  const params = {
    pair,
    type: side,
    ordertype: "market",
    volume: volume.toString(),
  };
  return krakenPrivate("AddOrder", params, apiKey, apiSecret);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let isAdmin = false;
    try {
      const user = await base44.auth.me();
      isAdmin = user?.role === "admin";
    } catch {
      isAdmin = true; // automation call
    }
    if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

    const apiKey = Deno.env.get("KRAKEN_API_KEY");
    const apiSecret = Deno.env.get("KRAKEN_API_SECRET");
    if (!apiKey || !apiSecret) return Response.json({ error: "Kraken API keys not configured" }, { status: 500 });

    const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true });
    if (!sessions || sessions.length === 0) {
      return Response.json({ status: "idle", message: "No active bot session" });
    }
    const session = sessions[0];
    const capital = session.assigned_capital || 0;
    if (capital < 10) return Response.json({ status: "skip", message: "Capital too low" });

    const closedResults = [];
    let sessionPnlDelta = 0;
    let sessionTradesDelta = 0;

    // ── Step 1: Close open trades that hit TP/SL or are stale ────────────────
    const openTrades = await base44.asServiceRole.entities.Trade.filter({ status: "open" });
    const openBotPairs = new Set(openTrades.map(t => `${t.bot_name}::${t.pair}`));

    for (const trade of openTrades) {
      const krakenPair = LABEL_TO_PAIR[trade.pair];
      if (!krakenPair) {
        // Unknown pair — mark closed to unblock
        await base44.asServiceRole.entities.Trade.update(trade.id, { status: "closed", exit_date: new Date().toISOString() });
        openBotPairs.delete(`${trade.bot_name}::${trade.pair}`);
        continue;
      }

      const currentPrice = await getLastPrice(krakenPair);
      if (!currentPrice) continue;

      const ageHours = (Date.now() - new Date(trade.entry_date).getTime()) / 3600000;
      const isLong = trade.side === "buy";
      const pricePct = (currentPrice - trade.entry_price) / trade.entry_price;

      const hitTP = isLong ? pricePct >= TP_PCT : pricePct <= -TP_PCT;
      const hitSL = isLong ? pricePct <= -SL_PCT : pricePct >= SL_PCT;
      const isStale = ageHours >= MAX_TRADE_HOURS;

      if (hitTP || hitSL || isStale) {
        const reason = hitTP ? "take_profit" : hitSL ? "stop_loss" : "timeout";
        const closeType = isLong ? "sell" : "buy";
        const minVol = MIN_VOL[krakenPair] || 0;
        
        let closedOnKraken = false;
        if (trade.amount >= minVol) {
          const closeResult = await placeOrder(krakenPair, closeType, trade.amount, apiKey, apiSecret);
          closedOnKraken = !closeResult.error?.length;
        }

        const pnl = isLong
          ? (currentPrice - trade.entry_price) * trade.amount
          : (trade.entry_price - currentPrice) * trade.amount;

        await base44.asServiceRole.entities.Trade.update(trade.id, {
          status: "closed",
          exit_price: currentPrice,
          exit_date: new Date().toISOString(),
          profit_loss: parseFloat(pnl.toFixed(4)),
          profit_loss_percent: parseFloat((pricePct * 100 * (isLong ? 1 : -1)).toFixed(2)),
          notes: (trade.notes || "") + ` | Closed: ${reason}${closedOnKraken ? " (Kraken order placed)" : ""}`,
        });

        openBotPairs.delete(`${trade.bot_name}::${trade.pair}`);
        sessionPnlDelta += pnl;
        closedResults.push({ trade_id: trade.id, reason, pnl: pnl.toFixed(4) });
      }
    }

    // ── Step 2: Get open orders to avoid spam ────────────────────────────────
    const openOrders = await getOpenOrders(apiKey, apiSecret);
    const openOrderPairs = new Set(Object.values(openOrders).map(o => o.descr?.pair));

    // Capital already deployed in open trades
    const openTradesAfterClose = await base44.asServiceRole.entities.Trade.filter({ status: "open" });
    const capitalDeployed = openTradesAfterClose.reduce((sum, t) => sum + (t.amount || 0) * (t.entry_price || 0), 0);
    const availableCapital = Math.max(0, capital - capitalDeployed);

    const newTradeResults = [];

    // ── Step 3: Place new trades based on signals ─────────────────────────────
    for (const pair of PAIRS) {
      if (openOrderPairs.has(pair)) {
        newTradeResults.push({ pair, status: "skip", reason: "open order exists" });
        continue;
      }

      const closes = await getCloses(pair);
      if (!closes || closes.length < 25) {
        newTradeResults.push({ pair, status: "skip", reason: "insufficient data" });
        continue;
      }

      const currentPrice = closes[closes.length - 1];
      if (!currentPrice) continue;

      for (const bot of BOTS) {
        const botCapital = (capital * bot.pct) / 100;
        const minVol = MIN_VOL[pair];
        // If bot's share is too small, try using all available capital (pool strategy)
        const effectiveCapital = botCapital >= minVol * currentPrice ? botCapital : availableCapital;
        const rawVolume = effectiveCapital / currentPrice;

        if (rawVolume < minVol) {
          newTradeResults.push({ pair, bot: bot.name, status: "skip", reason: `need €${(minVol * currentPrice).toFixed(2)} min, have €${effectiveCapital.toFixed(2)}` });
          continue;
        }

        const volume = Math.floor(rawVolume * 1e6) / 1e6;
        const botPairKey = `${bot.name}::${PAIR_LABELS[pair]}`;

        if (openBotPairs.has(botPairKey)) {
          newTradeResults.push({ pair, bot: bot.name, status: "skip", reason: "open trade exists" });
          continue;
        }

        const signal = getSignal(bot.strategy, closes);
        if (signal === "hold") {
          newTradeResults.push({ pair, bot: bot.name, status: "hold" });
          continue;
        }

        const orderResult = await placeOrder(pair, signal, volume, apiKey, apiSecret);
        const txids = orderResult.result?.txid || [];
        const hasError = orderResult.error?.length > 0;

        if (!hasError && txids.length > 0) {
          sessionTradesDelta++;
          const isLong = signal === "buy";
          const tpPrice = isLong ? currentPrice * (1 + TP_PCT) : currentPrice * (1 - TP_PCT);
          const slPrice = isLong ? currentPrice * (1 - SL_PCT) : currentPrice * (1 + SL_PCT);

          await base44.asServiceRole.entities.Trade.create({
            bot_name: bot.name,
            pair: PAIR_LABELS[pair],
            side: signal,
            entry_price: currentPrice,
            amount: volume,
            status: "open",
            take_profit: parseFloat(tpPrice.toFixed(2)),
            stop_loss: parseFloat(slPrice.toFixed(2)),
            entry_date: new Date().toISOString(),
            notes: `Strategy: ${bot.strategy} | TxID: ${txids.join(",")}`,
          });

          openBotPairs.add(botPairKey);
          newTradeResults.push({ pair, bot: bot.name, signal, volume, txid: txids[0], status: "executed" });
        } else {
          newTradeResults.push({ pair, bot: bot.name, signal, status: "error", error: orderResult.error?.[0] || "unknown" });
        }
      }
    }

    // ── Step 4: Update session stats ──────────────────────────────────────────
    const updates = {};
    if (sessionTradesDelta > 0) updates.total_trades = (session.total_trades || 0) + sessionTradesDelta;
    if (sessionPnlDelta !== 0) updates.total_pnl = parseFloat(((session.total_pnl || 0) + sessionPnlDelta).toFixed(4));
    if (Object.keys(updates).length > 0) {
      await base44.asServiceRole.entities.BotSession.update(session.id, updates);
    }

    return Response.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      session_id: session.id,
      capital,
      closed_trades: closedResults,
      new_trades: newTradeResults,
      trades_executed: sessionTradesDelta,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});