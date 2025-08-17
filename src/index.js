// src/index.js
const express = require('express');
const cors    = require('cors');
const api     = require('./api');
const morgan  = require('morgan');
const { Webhook } = require('svix');
const { PORT, CORS_ORIGIN_PRODUCTION, CORS_ORIGIN_LOCAL, SVIX_WEBHOOK_SECRET } = require('./config');
const { startBidJsSocket } = require('./bidjsSocket');
const { db } = require('./db');
const { redis } = require('./redis');
const { createLimitsService } = require('./api');
const { patchRegistrant } = require('./bidjs-rest'); // your patch helper
const { enqueueSuspensionRetry } = require('./services/retry'); // implementation earlier
const { recordAudit } = require('./services/audit'); // optional
const { createRecordAudit } = require('./services/audit');


const auditSvc = createRecordAudit({ db, redis, options: { logger: console }});
const recordAudit = auditSvc.recordAudit;


const { router: limitsRouter, ensureBidLimitCached } = (() => {
        const svc = createLimitsService({
          db,
          redis,
          patchRegistrant,
          enqueueSuspensionRetry,
          recordAudit,
          logger: console
        });
        return { router: svc.router, ensureBidLimitCached: svc.ensureBidLimitCached };
})();

app.use('/admin', limitsRouter);

const wh  = new Webhook(SVIX_WEBHOOK_SECRET);

const app = express();

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


//Responds to 'AUCTION_REGISTRATION' Webhook Event
app.post('/bidjs/webhook', express.raw({ type: 'application/json' }), async (req, res) => {

        const payload = req.body;
        const headers = req.headers;  

        let evt;
        try { //verify svix
          evt = wh.verify(payload, headers);
          console.log('Webhook verified:', evt);
        } catch (err) {
          return res.status(400).json({ error: 'Invalid webhook signature' });
        }

        try {

          const { auctionUuid, registrantUuid, userUuid, fullName } = evt;

          if (!auctionUuid || !registrantUuid || !userUuid) {
            return res.status(400).json({ error: 'Missing required fields' });
          }

          // 1. Upsert into MySQL
          const sql = `INSERT INTO registrants
              (auctionUuid, registrantUuid, userUuid, fullName)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              fullName = VALUES(fullName),
              updatedAt = CURRENT_TIMESTAMP`;

          const [result] = await db.query(sql, [
            auctionUuid, 
            registrantUuid, 
            userUuid, 
            fullName
          ]);
          console.log(`MySQL upsert: ${result.affectedRows} rows affected, ${result.changedRows} rows changed`);
          

          // 2. HMSET into Redis
          await redis.hset(`auction:${auctionUuid}:userToRegistrant`, userUuid, registrantUuid);
          await redis.hset(`auction:${auctionUuid}:registrant:${registrantUuid}`, {
            userUuid,
            fullName: fullName || '',
            bidLimit: ''
          });

          await redis.hset(`auction:${auctionUuid}:bidLimit`, userUuid, '');    

          const saved = await redis.hgetall(`auction:${auctionUuid}:registrant:${registrantUuid}`);
          console.log('Saved registrant hash:', saved);

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


app.listen(PORT, () => {
        console.log(`Admin API listening on port ${PORT}`);
        startBidJsSocket();
});
