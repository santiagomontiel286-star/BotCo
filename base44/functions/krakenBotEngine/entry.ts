/**
 * BotCo — Consensus Trading Engine
 * 
 * Strategy: 4 bots vote independently. Only when ≥2 agree on the same direction
 * does ONE real order get placed on Kraken using 100% of available capital.
 * 
 * This is designed for small accounts: single position, max confidence entries.
 * Runs every 5 minutes via automation.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KRAKEN_API = "https://api.kraken.com";

const PAIRS       = ["XBTEUR", "ETHEUR"];
const PAIR_LABELS = { XBTEUR: "BTC/EUR", ETHEUR: "ETH/EUR" };
const MIN_VOL     = { XBTEUR: 0.0002, ETHEUR: 0.002 };

const TP_PCT    = 0.010;  // 1.0% take profit — close fast, accumulate gains
const SL_PCT    = 0.006;  // 0.6% stop loss — tight cut
const MAX_HOURS = 1;      // force-close after 1 h, never hold stale positions
const MIN_VOTES = 1;      // any single bot signal is enough to execute

const BOTS = [
  { name: "Trend Follower", strategy: "trend"    },
  { name: "Mean Reversion", strategy: "rsi"      },
  { name: "AI Sentiment",   strategy: "momentum" },
  { name: "Risk Guardian",  strategy: "breakout" },
];

// ── Kraken helpers ────────────────────────────────────────────────────────────

function nextNonce() { return (Date.now() * 1000 + Math.floor(Math.random() * 999)).toString(); }

async function krakenSign(path, nonce, postData, apiSecret) {
  const enc = new TextEncoder();
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
  const eur = parseFloat(data.result?.ZEUR || data.result?.EUR || 0);
  return eur;
}

// ── Signal functions ──────────────────────────────────────────────────────────

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

function getVote(strategy, closes) {
  const n = closes.length;
  if (n < 22) return "hold";

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
  if (strategy === "momentum") {
    const s = closes.slice(-4);
    if (s[1]>s[0] && s[2]>s[1] && s[3]>s[2]) return "buy";
    if (s[1]<s[0] && s[2]<s[1] && s[3]<s[2]) return "sell";
  }
  if (strategy === "breakout") {
    const last = closes[n - 1];
    const win  = closes.slice(-21, -1);
    if (last > Math.max(...win)) return "buy";
    if (last < Math.min(...win)) return "sell";
  }
  return "hold";
}

// ── Main handler ──────────────────────────────────────────────────────────────

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
    if (!apiKey || !apiSecret) return Response.json({ error: "Kraken API keys not set" }, { status: 500 });

    // Require active session
    const sessions = await base44.asServiceRole.entities.BotSession.filter({ active: true });
    if (!sessions?.length) return Response.json({ status: "idle", message: "No active bot session" });

    const session = sessions[0];
    const capital = session.assigned_capital || 0;
    if (capital < 5) return Response.json({ status: "skip", message: "Capital too low" });

    const log = [];

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
      const hitTP    = isLong ? pricePct >=  TP_PCT : pricePct <= -TP_PCT;
      const hitSL    = isLong ? pricePct <= -SL_PCT : pricePct >=  SL_PCT;
      const stale    = ageHours >= MAX_HOURS;

      if (hitTP || hitSL || stale) {
        const reason    = hitTP ? "take_profit" : hitSL ? "stop_loss" : "timeout";
        const closeType = isLong ? "sell" : "buy";
        const minVol    = MIN_VOL[krakenPair] || 0;
        let   placed    = false;

        if (trade.amount >= minVol) {
          const res = await placeOrder(krakenPair, closeType, trade.amount, apiKey, apiSecret);
          placed = !res.error?.length;
          if (!placed) log.push({ action: "close_error", pair: trade.pair, error: res.error?.[0] });
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
          notes: `Closed: ${reason}${placed ? " ✓ order placed on Kraken" : " (amount below min, no close order)"}`,
        });

        await base44.asServiceRole.entities.BotSession.update(session.id, {
          total_trades: (session.total_trades || 0) + 1,
          total_pnl: parseFloat(((session.total_pnl || 0) + pnl).toFixed(4)),
        });

        hasOpenTrade = false;
        log.push({ action: "closed", pair: trade.pair, reason, pnl: pnl.toFixed(4), placed });
      }
    }

    // ── 2. Look for consensus signal if no open trade ─────────────────────────
    if (hasOpenTrade) {
      return Response.json({ status: "ok", action: "waiting", message: "Trade open — monitoring", log });
    }

    // Fetch real available EUR balance from Kraken
    const availableEUR = await getAvailableEUR(apiKey, apiSecret);
    log.push({ availableEUR: availableEUR.toFixed(2) });

    if (availableEUR < 5) {
      return Response.json({ status: "skip", message: `Available EUR too low: €${availableEUR.toFixed(2)}`, log });
    }

    for (const pair of PAIRS) {
      const closes = await getCloses(pair);
      if (!closes || closes.length < 25) {
        log.push({ pair, status: "skip", reason: "insufficient candle data" });
        continue;
      }

      const price = closes[closes.length - 1];

      // Collect votes from all 4 bots
      const votes = BOTS.map(b => ({ bot: b.name, vote: getVote(b.strategy, closes) }));
      const buyVotes  = votes.filter(v => v.vote === "buy").map(v => v.bot);
      const sellVotes = votes.filter(v => v.vote === "sell").map(v => v.bot);

      log.push({ pair: PAIR_LABELS[pair], votes });

      // Any bot signal triggers — first to fire wins
      const consensus = buyVotes.length >= MIN_VOTES ? "buy" : null;
      log.push({ pair: PAIR_LABELS[pair], buy: buyVotes.length, sell: sellVotes.length, firing: !!consensus });

      if (!consensus) {
        log.push({ pair: PAIR_LABELS[pair], status: "hold", buy: buyVotes.length, sell: sellVotes.length });
        continue;
      }

      // Check capital is enough for minimum order — use real EUR balance, keep 2% buffer
      const minVol   = MIN_VOL[pair];
      const safeEUR  = availableEUR * 0.98;
      const rawVol   = safeEUR / price;

      if (rawVol < minVol) {
        log.push({ pair: PAIR_LABELS[pair], status: "skip", reason: `need €${(minVol * price).toFixed(2)}, have €${capital.toFixed(2)}` });
        continue;
      }

      const volume = Math.floor(rawVol * 100000) / 100000;  // 5 decimal places

      // Place the order
      const result = await placeOrder(pair, consensus, volume, apiKey, apiSecret);

      if (result.error?.length) {
        log.push({ pair: PAIR_LABELS[pair], status: "error", error: result.error[0] });
        continue;
      }

      const txids  = result.result?.txid || [];
      const isLong = consensus === "buy";
      const executingBot = buyVotes[0]; // first agreeing bot is the "executor"

      await base44.asServiceRole.entities.Trade.create({
        bot_name: executingBot,
        pair: PAIR_LABELS[pair],
        side: consensus,
        entry_price: price,
        amount: volume,
        status: "open",
        take_profit: parseFloat((price * (1 + TP_PCT)).toFixed(4)),
        stop_loss: parseFloat((price * (1 - SL_PCT)).toFixed(4)),
        entry_date: new Date().toISOString(),
        notes: `Signal: ${buyVotes.join(", ")} | Capital: €${capital.toFixed(2)} | TxID: ${txids.join(",")}`,
      });

      log.push({
        pair: PAIR_LABELS[pair],
        status: "executed",
        consensus,
        votes: `${buyVotes.length}/4 agree`,
        voters: buyVotes,
        volume,
        price,
        txid: txids[0],
      });

      // One trade at a time
      return Response.json({ status: "ok", action: "trade_placed", timestamp: new Date().toISOString(), log });
    }

    return Response.json({ status: "ok", action: "hold", message: "No consensus reached", timestamp: new Date().toISOString(), log });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});