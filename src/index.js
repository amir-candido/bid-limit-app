// src/index.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Webhook } = require('svix');
const { PORT, CORS_ORIGIN_PRODUCTION, CORS_ORIGIN_LOCAL, SVIX_WEBHOOK_SECRET, SESSION_SECRET } = require('./config');
const { startBidJsSocket } = require('./bidjsSocket');
const { db } = require('./db');
const { redis } = require('./redis');
const { createLimitsService } = require('./api'); // ensure this module exports createLimitsService
const { patchRegistrant } = require('./bidjs-rest');
const { enqueueSuspensionRetry } = require('./services/enqueueSuspensionRetry');
const { createRecordAudit } = require('./services/audit');
const { syncAuctions } = require('./services/syncAuctions');
const createAuthService = require('./services/createAuthService'); 
const app = express(); // MUST be created before any app.use

// create audit service
const auditSvc = createRecordAudit({ db, redis, options: { logger: console } });
const recordAudit = auditSvc.recordAudit;

// create limits service (wires db/redis/patchRegistrant/etc)
const limitsSvc = createLimitsService({
  db,
  redis,
  patchRegistrant,
  enqueueSuspensionRetry,
  recordAudit,
  logger: console
});
const limitsRouter = limitsSvc.router;


// configure webhook verifier
const wh = new Webhook(SVIX_WEBHOOK_SECRET);

// configure CORS
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

// morgan logger - mount near top so all requests are logged; use custom token to avoid Buffer serialization issues
morgan.token('req-body', (req) => {
  try {
    if (!req.body) return '';
    if (Buffer.isBuffer(req.body)) return `<raw ${req.body.length} bytes>`;
    return JSON.stringify(req.body);
  } catch (e) {
    return '<unserializable body>';
  }
});
app.use(morgan(':method :url :status :response-time ms - Body: :req-body - Headers: :req[header]'));

(async () => {
  try {
    // 1) Ensure auctions are seeded before serving traffic
    await syncAuctions({ db });

    // 2) Start server after auctions synced
    app.listen(PORT, () => {
      console.log(`Admin API listening on port ${PORT}`);
      startBidJsSocket();
    });
  } catch (err) {
    console.error('Startup failed, exiting:', err);
    process.exit(1);
  }
})();

// Webhook endpoint (raw body preserved for signature verification)
app.post('/bidjs/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body; // Buffer
  const headers = req.headers;

  // svix verify — pass string if library requires it
  let evt;
  try {
    // If svix accepts Buffer, this is fine; otherwise convert to string
    const payloadForVerify = (typeof payload === 'string') ? payload : payload.toString('utf8');
    evt = wh.verify(payloadForVerify, headers);
    console.log('Webhook verified:', evt);
  } catch (err) {
    console.warn('Invalid webhook signature:', err && err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    const { auctionUuid, registrantUuid, userUuid, fullName } = evt;
    if (!auctionUuid || !registrantUuid || !userUuid) {
      console.warn('Webhook missing required fields:', { auctionUuid, registrantUuid, userUuid });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1) Upsert into DB (authoritative)
    const sql = `
      INSERT INTO registrants
        (auctionUuid, registrantUuid, userUuid, fullName)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        fullName = VALUES(fullName),
        updatedAt = CURRENT_TIMESTAMP
    `;
    const [result] = await db.query(sql, [auctionUuid, registrantUuid, userUuid, fullName]);
    console.log(`MySQL upsert: affected=${result.affectedRows}, changed=${result.changedRows}`);

    // 2) Update Redis cache (best-effort)
    const registrantHashKey = `auction:${auctionUuid}:registrant:${registrantUuid}`;
    await redis.hset(`auction:${auctionUuid}:userToRegistrant`, userUuid, registrantUuid);
    await redis.hset(registrantHashKey, {
      userUuid,
      fullName: fullName || '',
      bidLimit: '' // empty string denotes unlimited
    });
    // Use canonical key name for bid limits
    await redis.hset(`auction:${auctionUuid}:userBidLimit`, userUuid, '');

    // verify saved
    const saved = await redis.hgetall(registrantHashKey);
    console.log('Saved registrant hash:', saved);

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Option: return 200 to avoid retries and log internal failure
    res.sendStatus(500);
  }
});

// JSON body parser for normal routes (webhook uses express.raw below)
app.use(express.json());

console.log("Session secret:", SESSION_SECRET);

const authSvc = createAuthService({
  db,
  SESSION_SECRET,
  cookieOpts: { secure: process.env.NODE_ENV === 'production' },
  logger: console
});

app.use(authSvc.sessionMiddleware);

// attach user convenience middleware (optional)
app.use(authSvc.attachUser);

// mount auth routes
app.use('/auth', authSvc.router);

// protect admin routes: require auth for the admin UI & APIs
app.use('/admin', authSvc.requireAuth, limitsRouter);

// start server after all routes/middleware registered
app.listen(PORT, () => {
  console.log(`Admin API listening on port ${PORT}`);
  startBidJsSocket();
});

// graceful shutdown & error handling hooks (recommended)
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection', err);
});
process.on('SIGINT', async () => {
  console.info('SIGINT received: closing resources');
  try { await redis.quit(); } catch (e) {}
  try { await db.end(); } catch (e) {}
  process.exit(0);
});
