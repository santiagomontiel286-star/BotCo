/**
 * BotCo — Multi-Profile Trading Engine v2
 *
 * Features:
 * - Demo mode (simulated orders with real market data + slippage)
 * - 3 risk profiles: Conservador, Balanceado, Agresivo
 * - 6 bot strategies (adds Momentum Bot + Breakout Bot)
 * - Signal scoring system (0-100), minimum threshold per profile
 * - Compounding: position size based on current real balance
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = "https://api.kraken.com";
const PAIRS       = ["XBTEUR", "ETHEUR"];
const PAIR_LABELS = { XBTEUR: "BTC/EUR", ETHEUR: "ETH/EUR" };
const MIN_VOL     = { XBTEUR: 0.0002, ETHEUR: 0.002 };

// ── Risk profiles ──────────────────────────────────────────────────────────────
const PROFILES = {
  conservador: {
    TP: 0.010, SL: 0.006, maxHours: 1, minScore: 40,
    strategies: ["trend", "rsi", "momentum_ai", "breakout_risk"],
  },
  balanceado: {
    TP: 0.015, SL: 0.009, maxHours: 2, minScore: 50,
    strategies: ["trend", "rsi", "momentum_ai", "breakout_risk", "momentum"],
  },
  agresivo: {
    TP: 0.025, SL: 0.012, maxHours: 3, minScore: 35,
    strategies: ["trend", "rsi", "momentum_ai", "breakout_risk", "momentum", "breakout"],
  },
};

const ALL_BOTS = [
  { name: "Trend Follower", strategy: "trend" },
  { name: "Mean Reversion", strategy: "rsi" },
  { name: "AI Sentiment",   strategy: "momentum_ai" },
  { name: "Risk Guardian",  strategy: "breakout_risk" },
  { name: "Momentum Bot",   strategy: "momentum" },
  { name: "Breakout Bot",   strategy: "breakout" },
];

// ── Kraken helpers ─────────────────────────────────────────────────────────────

function nextNonce() { return (Date.now() * 1000 + Math.floor(Math.random() * 999)).toString(); }

async function krakenSign(path, nonce, postData, apiSecret) {
  const enc  = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(nonce + postData));
  const key  = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(apiSecret), c => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const pathBytes = enc.encode(path);
  const combined  = new Uint8Array(pathBytes.length + hash.byteLength);
  combined.set(pathBytes, 0);
  combined.set(new Uint8Array(hash), pathBytes.length);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, combined))));
}

async function krakenPrivate(endpoint, params, apiKey, apiSecret) {
  const nonce = nextNonce();
  const body  = new URLSearchParams({ nonce, ...params }).toString();
  const path  = `/0/private/${endpoint}`;
  const res   = await fetch(`${KRAKEN_API}${path}`, {
    method: "POST",
    headers: { "API-Key": apiKey, "API-Sign": await krakenSign(path, nonce, body, apiSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return res.json();
}

async function krakenPublic(endpoint, params = {}) {
  const qs  = new URLSearchParams(params).toString();
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

async function placeOrder(pair, side, volume, apiKey, apiSecret) {
  return krakenPrivate("AddOrder", { pair, type: side, ordertype: "market", volume: volume.toString() }, apiKey, apiSecret);
}

async function getAvailableEUR(apiKey, apiSecret) {
  const data = await krakenPrivate("Balance", {}, apiKey, apiSecret);
  if (data.error?.length) return 0;
  return parseFloat(data.result?.ZEUR || data.result?.EUR || 0);
}

// ── Technical indicators ───────────────────────────────────────────────────────

function ema(prices, period) {
  const k = 2 / (period + 1);
  return prices.reduce((acc, p, i) => {
    acc.push(i === 0 ? p : p * k + acc[i - 1] * (1 - k));
    return acc;
  }, []);
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(0, d)) / period;
    al = (al * (period - 1) + Math.max(0, -d)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

// ── Strategy votes ─────────────────────────────────────────────────────────────

function getVote(strategy, closes) {
  const n = closes.length;
  if (n < 30) return "hold";

  if (strategy === "trend") {
    const e9 = ema(closes, 9), e21 = ema(closes, 21);
    if (e9[n-2] < e21[n-2] && e9[n-1] > e21[n-1]) return "buy";
    if (e9[n-2] > e21[n-2] && e9[n-1] < e21[n-1]) return "sell";
  }
  if (strategy === "rsi") {
    const r = rsi(closes, 14);
    if (r < 35) return "buy";
    if (r > 65) return "sell";
  }
  if (strategy === "momentum_ai") {
    const s = closes.slice(-4);
    if (s[1]>s[0] && s[2]>s[1] && s[3]>s[2]) return "buy";
    if (s[1]<s[0] && s[2]<s[1] && s[3]<s[2]) return "sell";
  }
  if (strategy === "breakout_risk") {
    const last = closes[n - 1];
    const win  = closes.slice(-21, -1);
    if (last > Math.max(...win)) return "buy";
    if (last < Math.min(...win)) return "sell";
  }
  if (strategy === "momentum") {
    // MACD-like: EMA12 vs EMA26 crossover with signal line
    const e12  = ema(closes, 12), e26 = ema(closes, 26);
    const macd = e12.map((v, i) => v - e26[i]);
    const sig  = ema(macd, 9);
    if (macd[n-2] < sig[n-2] && macd[n-1] > sig[n-1]) return "buy";
    if (macd[n-2] > sig[n-2] && macd[n-1] < sig[n-1]) return "sell";
  }
  if (strategy === "breakout") {
    // Tight consolidation range breakout (range < 1.5% amplitude over last 12 candles)
    const window = closes.slice(-12);
    const high   = Math.max(...window.slice(0, -1));
    const low    = Math.min(...window.slice(0, -1));
    const range  = (high - low) / low;
    const last   = closes[n - 1];
    if (range < 0.015 && last > high) return "buy";
    if (range < 0.015 && last < low)  return "sell";
  }
  return "hold";
}

// ── Signal scoring (0-100) ─────────────────────────────────────────────────────

function scoreSignal(closes, direction) {
  let score = 30; // base score for any signal
  const n   = closes.length;

  // RSI in favorable zone (+20)
  const r = rsi(closes, 14);
  if (direction === "buy"  && r < 60 && r > 20) score += 20;
  if (direction === "sell" && r > 40 && r < 80) score += 20;

  // EMA50 macro alignment (+25)
  if (n >= 50) {
    const e50       = ema(closes, 50);
    const aboveEMA  = closes[n-1] > e50[n-1];
    if (direction === "buy"  && aboveEMA)  score += 25;
    if (direction === "sell" && !aboveEMA) score += 25;
  }

  // 3-candle momentum confirmation (+25)
  const recent     = closes.slice(-3);
  const isBullish  = recent[2] > recent[0];
  if (direction === "buy"  && isBullish)  score += 25;
  if (direction === "sell" && !isBullish) score += 25;

  return Math.min(score, 100);
}

// ── Demo price simulation ──────────────────────────────────────────────────────

function simulatePrice(price, side) {
  const slippage = 0.0005 + Math.random() * 0.0005; // 0.05%–0.10%
  return side === "buy" ? price * (1 + slippage) : price * (1 - slippage);
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth: allow automation (no token) or admin
    try {
      const user = await base44.auth.me();
      if (user && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    } catch { /* automation call — no user */ }

    const apiKey    = Deno.env.get("KRAKEN_API_KEY");
    const apiSecret = Deno.env.get("KRAKEN_API_SECRET");

    // Require active session
    const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true });
    if (!sessions?.length) return Response.json({ status: "idle", message: "No active bot session" });

    const session     = sessions[0];
    const sessionMode = session.mode || "real";
    const profileKey  = session.risk_profile || "conservador";
    const profile     = PROFILES[profileKey] || PROFILES.conservador;
    const capital     = session.assigned_capital || 0;

    if (capital < 5) return Response.json({ status: "skip", message: "Capital too low" });
    if (sessionMode === "real" && (!apiKey || !apiSecret)) {
      return Response.json({ error: "Kraken API keys not set" }, { status: 500 });
    }

    // Active bots for this profile
    const activeBots = ALL_BOTS.filter(b => profile.strategies.includes(b.strategy));
    const { TP, SL, maxHours, minScore } = profile;
    const log = [];
    log.push({ sessionMode, profileKey, activeBots: activeBots.map(b => b.name) });

    // ── 1. Manage open trade ──────────────────────────────────────────────────
    const openTrades   = await base44.asServiceRole.entities.Trade.filter({ status: "open" });
    let   hasOpenTrade = openTrades.length > 0;

    for (const trade of openTrades) {
      const krakenPair = Object.keys(PAIR_LABELS).find(k => PAIR_LABELS[k] === trade.pair);
      if (!krakenPair) {
        await base44.asServiceRole.entities.Trade.update(trade.id, { status: "closed", exit_date: new Date().toISOString() });
        hasOpenTrade = false;
        continue;
      }

      const price    = await getLastPrice(krakenPair);
      if (!price) continue;

      const ageHours = (Date.now() - new Date(trade.entry_date || trade.created_date).getTime()) / 3600000;
      const isLong   = trade.side === "buy";
      const pricePct = (price - trade.entry_price) / trade.entry_price;
      const hitTP    = isLong ? pricePct >=  TP : pricePct <= -TP;
      const hitSL    = isLong ? pricePct <= -SL : pricePct >=  SL;
      const stale    = ageHours >= maxHours;

      if (hitTP || hitSL || stale) {
        const reason    = hitTP ? "take_profit" : hitSL ? "stop_loss" : "timeout";
        const closeType = isLong ? "sell" : "buy";
        const minVol    = MIN_VOL[krakenPair] || 0;
        let   placed    = false;

        if (sessionMode === "real" && trade.amount >= minVol) {
          const res = await placeOrder(krakenPair, closeType, trade.amount, apiKey, apiSecret);
          placed = !res.error?.length;
          if (!placed) log.push({ action: "close_error", pair: trade.pair, error: res.error?.[0] });
        } else if (sessionMode === "demo") {
          placed = true;
        }

        const exitPrice = sessionMode === "demo" ? simulatePrice(price, closeType) : price;
        const pnl = isLong
          ? (exitPrice - trade.entry_price) * trade.amount
          : (trade.entry_price - exitPrice) * trade.amount;

        await base44.asServiceRole.entities.Trade.update(trade.id, {
          status: "closed",
          exit_price: exitPrice,
          exit_date: new Date().toISOString(),
          profit_loss: parseFloat(pnl.toFixed(4)),
          profit_loss_percent: parseFloat((pricePct * 100 * (isLong ? 1 : -1)).toFixed(2)),
          notes: `[${sessionMode.toUpperCase()}·${profileKey}] Closed: ${reason}${placed ? " ✓" : " (skipped)"}`,
        });

        await base44.asServiceRole.entities.BotSession.update(session.id, {
          total_trades: (session.total_trades || 0) + 1,
          total_pnl: parseFloat(((session.total_pnl || 0) + pnl).toFixed(4)),
        });

        hasOpenTrade = false;
        log.push({ action: "closed", pair: trade.pair, reason, pnl: pnl.toFixed(4), mode: sessionMode });
      }
    }

    // ── 2. Look for new signal if no open trade ───────────────────────────────
    if (hasOpenTrade) {
      return Response.json({ status: "ok", action: "waiting", message: "Trade open — monitoring", log });
    }

    // Get available balance (real or demo)
    let availableEUR = 0;
    if (sessionMode === "real") {
      availableEUR = await getAvailableEUR(apiKey, apiSecret);
    } else {
      // Demo: starting capital + accumulated session P&L
      const closedTrades  = await base44.asServiceRole.entities.Trade.filter({ status: "closed" });
      const sessionStart  = new Date(session.started_at || session.created_date).getTime();
      const sessionPnl    = closedTrades
        .filter(t => new Date(t.entry_date || t.created_date).getTime() >= sessionStart - 60000)
        .reduce((s, t) => s + (t.profit_loss || 0), 0);
      availableEUR = capital + sessionPnl;
    }

    log.push({ availableEUR: availableEUR.toFixed(2), mode: sessionMode });

    if (availableEUR < 5) {
      return Response.json({ status: "skip", message: `Available EUR too low: €${availableEUR.toFixed(2)}`, log });
    }

    for (const pair of PAIRS) {
      const closes = await getCloses(pair);
      if (!closes || closes.length < 30) {
        log.push({ pair, status: "skip", reason: "insufficient candle data" });
        continue;
      }

      const price = closes[closes.length - 1];

      // Votes from profile-active bots only
      const votes     = activeBots.map(b => ({ bot: b.name, vote: getVote(b.strategy, closes) }));
      const buyVotes  = votes.filter(v => v.vote === "buy").map(v => v.bot);
      const sellVotes = votes.filter(v => v.vote === "sell").map(v => v.bot);

      log.push({ pair: PAIR_LABELS[pair], votes });

      if (buyVotes.length === 0) {
        log.push({ pair: PAIR_LABELS[pair], status: "hold", sell: sellVotes.length });
        continue;
      }

      // Score the signal
      const score = scoreSignal(closes, "buy");
      log.push({ pair: PAIR_LABELS[pair], buy: buyVotes.length, sell: sellVotes.length, score, minScore });

      if (score < minScore) {
        log.push({ pair: PAIR_LABELS[pair], status: "low_score", score, minScore });
        continue;
      }

      // Dynamic position sizing by score (compounding with current balance)
      const sizeFactor = score >= 80 ? 1.0 : 0.6;
      const safeEUR    = availableEUR * 0.98 * sizeFactor;
      const minVol     = MIN_VOL[pair];
      const rawVol     = safeEUR / price;

      if (rawVol < minVol) {
        log.push({ pair: PAIR_LABELS[pair], status: "skip", reason: `need €${(minVol * price).toFixed(2)}, have €${safeEUR.toFixed(2)}` });
        continue;
      }

      const volume       = Math.floor(rawVol * 100000) / 100000;
      const executingBot = buyVotes[0];
      let   txids        = [];

      if (sessionMode === "real") {
        const result = await placeOrder(pair, "buy", volume, apiKey, apiSecret);
        if (result.error?.length) {
          log.push({ pair: PAIR_LABELS[pair], status: "error", error: result.error[0] });
          continue;
        }
        txids = result.result?.txid || [];
      }

      const entryPrice = sessionMode === "demo" ? simulatePrice(price, "buy") : price;

      await base44.asServiceRole.entities.Trade.create({
        bot_name:    executingBot,
        pair:        PAIR_LABELS[pair],
        side:        "buy",
        entry_price: entryPrice,
        amount:      volume,
        status:      "open",
        take_profit: parseFloat((entryPrice * (1 + TP)).toFixed(4)),
        stop_loss:   parseFloat((entryPrice * (1 - SL)).toFixed(4)),
        entry_date:  new Date().toISOString(),
        notes: `[${sessionMode.toUpperCase()}·${profileKey}] Score: ${score}/100 | Voters: ${buyVotes.join(", ")} | €${capital.toFixed(2)}${txids.length ? ` | TxID: ${txids[0]}` : ""}`,
      });

      log.push({
        pair: PAIR_LABELS[pair], status: "executed", mode: sessionMode, profile: profileKey,
        score, voters: buyVotes, volume, price: entryPrice, txid: txids[0] || "demo-sim",
      });

      return Response.json({ status: "ok", action: "trade_placed", mode: sessionMode, profile: profileKey, timestamp: new Date().toISOString(), log });
    }

    return Response.json({ status: "ok", action: "hold", message: "No valid signal", mode: sessionMode, timestamp: new Date().toISOString(), log });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});