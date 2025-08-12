import Redis from "ioredis";
import WebSocket from "ws";
import fetch from "node-fetch";

const redis = new Redis(process.env.REDIS_URL);
const auctionId = process.env.AUCTION_ID;

// connect to BidJS WS (pseudo)
function connect() {
  const ws = new WebSocket(process.env.BIDJS_WS_URL, {
    headers: { Authorization: `Bearer ${process.env.BIDJS_API_KEY}` }
  });

  ws.on("open", () => console.log("WS connected"));
  ws.on("message", async (buff) => {
    const evt = JSON.parse(buff.toString());
    // normalize minimal shape
    const { eventType, listingId, highestBidderUserId } = evt;
    if (!listingId) return;

    const leaderKey = `leader:${auctionId}:${listingId}`;
    const prev = (await redis.get(leaderKey)) || "";
    const next = highestBidderUserId || "";

    if (prev && prev !== next) await redis.decr(`activeCount:${auctionId}:${prev}`);
    if (next && next !== prev) await redis.incr(`activeCount:${auctionId}:${next}`);
    await redis.set(leaderKey, next);

    // enforce for affected users
    for (const userId of [prev, next].filter(Boolean)) await enforce(auctionId, userId);
  });

  ws.on("close", () => setTimeout(connect, 1500));
  ws.on("error", (e) => console.error("WS error", e));
}

async function enforce(auctionId, userId) {
  const activeCount = Number(await redis.get(`activeCount:${auctionId}:${userId}`)) || 0;

  const override = await redis.get(`limit:override:${auctionId}:${userId}`);
  const def = await redis.get(`limit:default:${auctionId}`);
  const val = override ?? def ?? "UNLIMITED";
  const isUnlimited = String(val).toUpperCase() === "UNLIMITED";
  const limit = isUnlimited ? Infinity : Number(val);
  const desired = isUnlimited || activeCount < limit ? "APPROVED" : "SUSPENDED";

  const statusKey = `status:${auctionId}:${userId}`;
  const cached = (await redis.get(statusKey)) ? JSON.parse(await redis.get(statusKey)) : null;
  const currentStatus = cached?.status ?? null;
  const registrantId = cached?.registrantId ?? null;

  if (!registrantId || currentStatus === desired) return;

  const ok = await patchRegistrantStatus(auctionId, registrantId, desired);
  if (ok) {
    await redis.set(statusKey, JSON.stringify({ status: desired, registrantId, updatedAt: new Date().toISOString() }));
    console.log(`enforced ${userId}: ${desired} (active=${activeCount}, limit=${isUnlimited ? "∞" : limit})`);
  }
}

async function patchRegistrantStatus(auctionId, registrantId, status) {
  // call BidJS REST – replace with real endpoint
  try {
    const r = await fetch(`${process.env.BIDJS_BASE_URL}/auctions/${auctionId}/registrants/${registrantId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BIDJS_API_KEY}` },
      body: JSON.stringify({ status })
    });
    return r.ok;
  } catch (e) {
    console.error("PATCH failed", e);
    return false;
  }
}

connect();
