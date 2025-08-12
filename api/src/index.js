import express from "express";
import cors from "cors";
import Redis from "ioredis";

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

const redis = new Redis(process.env.REDIS_URL);

// READ limits
app.get("/auctions/:auctionId/limits/:userId", async (req, res) => {
  const { auctionId, userId } = req.params;
  const override = await redis.get(`limit:override:${auctionId}:${userId}`);
  const def = await redis.get(`limit:default:${auctionId}`);
  res.json({
    limitOverride: override ?? null,
    defaultLotLimit: def ?? null
  });
});

// WRITE default
app.patch("/auctions/:auctionId/default-limit", async (req, res) => {
  const { auctionId } = req.params;
  const { defaultLotLimit } = req.body; // number | "UNLIMITED" | null
  if (defaultLotLimit === null) await redis.del(`limit:default:${auctionId}`);
  else await redis.set(`limit:default:${auctionId}`, String(defaultLotLimit));
  res.sendStatus(204);
});

// WRITE override
app.patch("/auctions/:auctionId/registrants/:userId/limit", async (req, res) => {
  const { auctionId, userId } = req.params;
  const { limitOverride } = req.body; // number | "UNLIMITED" | null
  const key = `limit:override:${auctionId}:${userId}`;
  if (limitOverride === null) await redis.del(key);
  else await redis.set(key, String(limitOverride));
  res.sendStatus(204);
});

// Health
app.get("/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(process.env.API_PORT || 8080, () =>
  console.log(`API on :${process.env.API_PORT || 8080}`)
);
