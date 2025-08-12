// src/index.js
const express = require('express');
const cors    = require('cors');
const api     = require('./api');
const morgan  = require('morgan');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const { Svix, Webhook } = require('svix');
const { startScheduler } = require('./poller');
const { PORT, CORS_ORIGIN_PRODUCTION, CORS_ORIGIN_LOCAL, DB_USER, DB_PASSWORD, SVIX_WEBHOOK_SECRET } = require('./config');
const { startBidJsSocket } = require('./bidjsSocket');

const app = express();

//This prevents undefined entries if you forget to define one in your .env.
const allowed = [CORS_ORIGIN_LOCAL, CORS_ORIGIN_PRODUCTION].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    
    console.warn(`🚫 Blocked CORS request from: ${origin}`);
    cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET','POST','PATCH','OPTIONS']
}));


app.post('/bidjs/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body;
  const headers = req.headers;
  const wh      = new Webhook(SVIX_WEBHOOK_SECRET);

  let evt;
  try {
    evt = wh.verify(payload, headers);
    console.log('Webhook verified:', evt);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {

    const { auctionUuid, registrantUuid, userUuid, fullName, bidLimit } = evt;

    if (!auctionUuid || !registrantUuid || !userUuid) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Upsert into MySQL
    const sql = `
      INSERT INTO registrants
        (auctionUuid, registrantUuid, userUuid, fullName, bidLimit)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        fullName = VALUES(fullName),
        bidLimit = VALUES(bidLimit),
        updatedAt = CURRENT_TIMESTAMP
    `;
    await db.query(sql, [auctionUuid, registrantUuid, userUuid, fullName, bidLimit]);
    db.on('error', (err) => console.error('MySQL pool error:', err));

    // 2. HMSET into Redis
    const redisKey = `registrant:${auctionUuid}:${userUuid}`;
    await redis.hset(redisKey, {
      auctionUuid,
      registrantUuid,
      userUuid,
      fullName: fullName || '',
      bidLimit: bidLimit ?? ''  // Preserves 0
    });
    redis.on('error', (err) => console.error('Redis error:', err));

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.sendStatus(500); // Or 200 to avoid retries, log internally
  }
});

// JSON‑body parsing
app.use(express.json());

app.use(morgan((tokens, req, res) => {
  return [
    tokens.method(req, res),
    tokens.url(req, res),
    tokens.status(req, res),
    tokens['response-time'](req, res), 'ms',
    '- Body:', JSON.stringify(req.body),
    '- Headers:', JSON.stringify(req.headers)
  ].join(' ');
}));


// Mount your admin API
app.use('/admin', api);

// MySQL connection
const db = mysql.createPool({
  host: 'localhost',
  user: DB_USER,
  password: DB_PASSWORD,
  database: 'bidapp'
});

// Redis connection
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379
});

app.listen(PORT, () => {
  console.log(`Admin API listening on port ${PORT}`);
  //startScheduler();
  //startBidJsSocket();
});
