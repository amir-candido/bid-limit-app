// src/api.js
const express = require('express');

/**
 * createLimitsService - returns helper functions and an express router for admin limit operations.
 *
 * Dependencies (passed into factory):
 *   - db: mysql2/promise pool (required)
 *   - redis: ioredis client (required)
 *   - patchRegistrant: async (auctionUuid, registrantUuid, status) -> performs BidJS PATCH
 *   - enqueueSuspensionRetry: async(job) -> schedules retry (optional but recommended)
 *   - recordAudit: async(actionObj) -> persists audit (optional)
 *   - logger: object with .info/.warn/.error methods (optional -> console)
 *
 * Exported:
 *   - ensureBidLimitCached(redis, db, auctionUuid, userUuid, opts)
 *   - router (Express Router) mounted with routes described above
 */
function createLimitsService({ db, redis, patchRegistrant, enqueueSuspensionRetry, recordAudit, logger = console }) {

        if (!db || !redis) {throw new Error('db and redis are required');}

        const bidLimitHashPrefix    = (auctionUuid) => `auction:${auctionUuid}:userBidLimit`;
        const userToRegistrantHash  = (auctionUuid) => `auction:${auctionUuid}:userToRegistrant`;
        const activePrefix          = (auctionUuid) => `auction:${auctionUuid}:userActiveLots:`; // append userUuid
        const awaitingFlagKey       = (auctionUuid, userUuid) => `auction:${auctionUuid}:userAwaitingDeposit:${userUuid}`;

        // -------------------------
        // ensureBidLimitCached
        // -------------------------
        // Robust cache-warming with a short lock to avoid thundering herd.
        async function ensureBidLimitCached(redis, db, auctionUuid, userUuid, opts = {}) {
          const { forceRefresh = false, lockTtlMs = 2000, lockWaitMs = 100, lockMaxAttempts = 20 } = opts;
          const hashKey = bidLimitHashPrefix(auctionUuid);

          // quick check
          try {
            if (!forceRefresh) {
              const cached = await redis.hget(hashKey, userUuid);
              if (cached !== null) return cached;
            }
          } catch (err) {
            logger.warn('Redis hget failed in ensureBidLimitCached (will fallback to DB):', err.message);
            // proceed to db fallback
          }

          // Acquire a simple lock (SET NX) to make one process populate cache
          const lockKey = `${hashKey}:lock:${userUuid}`;
          const lockVal = String(process.pid || Math.random());
          let gotLock = false;
          try {
            const setRes = await redis.set(lockKey, lockVal, 'NX', 'PX', lockTtlMs);
            gotLock = !!setRes;
          } catch (err) {
            logger.warn('Redis set lock failed, continuing to DB read:', err.message);
            // continue without lock
          }

          if (!gotLock) {
            // Wait / spin until other worker has set cache or lock expires
            let attempts = 0;
            while (attempts < lockMaxAttempts) {
              try {
                const val = await redis.hget(hashKey, userUuid);
                if (val !== null) return val;
              } catch (err) {
                logger.warn('Redis hget while waiting for lock failed:', err.message);
              }
              // sleep
              await new Promise((r) => setTimeout(r, lockWaitMs));
              attempts += 1;
            }
            // fallback to DB if still missing
          }

          // Now populate from DB
          try {
            const [rows] = await db.execute(
              `SELECT bidLimit FROM registrants WHERE auctionUuid = ? AND userUuid = ? LIMIT 1`,
              [auctionUuid, userUuid]
            );
            const bidLimitVal = (rows && rows.length && rows[0].bidLimit != null) ? String(rows[0].bidLimit) : '';
            try {
              // write-through (best-effort)
              await redis.hset(hashKey, userUuid, bidLimitVal);
            } catch (err) {
              logger.warn('Failed to populate bidLimit cache in Redis:', err.message);
            }
            return bidLimitVal;
          } catch (err) {
            logger.error('DB error in ensureBidLimitCached:', err);
            throw err;
          } finally {
            // release lock if we held it
            try {
              const cur = await redis.get(lockKey);
              if (cur === lockVal) await redis.del(lockKey);
            } catch (e) {
              // ignore
            }
          }
        }

        // -------------------------
        // helpers: fetch activeCount & awaiting flags in batch
        // -------------------------
        async function fetchLiveFieldsForMany(auctionUuid, userUuids = []) {
          // returns mapping userUuid -> { activeCount: Number, awaitingFlag: boolean, cachedLimit: string|null }
          if (!userUuids || userUuids.length === 0) return {};

          const pipeline = redis.pipeline();
          // SCARD for each userActiveLots
          for (const u of userUuids) {
            pipeline.scard(`${activePrefix(auctionUuid)}${u}`);
          }
          // GET awaiting flags
          for (const u of userUuids) {
            pipeline.get(awaitingFlagKey(auctionUuid, u));
          }
          // HGET from bidLimit hash for each user (use HMGET is better to batch, but we'll do individual hget to keep order)
          pipeline.hmget(bidLimitHashPrefix(auctionUuid), ...userUuids); // hmget returns array matching userUuids

          const res = await pipeline.exec();
          // res array has: scard x N, get x N, hmget result at last position (single array)
          const scardResults = res.slice(0, userUuids.length).map(r => (r[0] ? null : r[1]));
          const getResults = res.slice(userUuids.length, userUuids.length * 2).map(r => (r[0] ? null : r[1]));
          const hmgetResult = res[userUuids.length * 2] && res[userUuids.length * 2][1] ? res[userUuids.length * 2][1] : [];

          const out = {};
          for (let i = 0; i < userUuids.length; i += 1) {
            const u = userUuids[i];
            const activeCount = Number(scardResults[i] || 0);
            const awaitingFlag = !!getResults[i];
            const cachedLimit = (hmgetResult && hmgetResult[i] !== null && hmgetResult[i] !== undefined) ? hmgetResult[i] : null;
            out[u] = { activeCount, awaitingFlag, cachedLimit };
          }
          return out;
        }

        // -------------------------
        // Router
        // -------------------------
        const router = express.Router();

        router.get('/auctions', async (req, res) => {
          try {
            const [rows] = await db.execute(`SELECT auctionUuid, title FROM auctions ORDER BY createdAt DESC`);
            // Return array of { auctionUuid, title }
            const out = rows.map(r => ({ auctionUuid: r.auctionUuid, title: r.title }));
            return res.json(out);
          } catch (err) {
            logger.error('GET /auctions failed:', err);
            return res.status(500).json({ error: 'internal_error' });
          }
        });        

        // GET /admin/:auctionUuid/registrants
        // Query: ?q=&page=&pageSize=&sort=
        router.get('/auctions/:auctionUuid/registrants', async (req, res) => {
          const auctionUuid = req.params.auctionUuid;
          const q = req.query.q ? String(req.query.q).trim() : null;
          const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 50));
          const page = Math.max(1, Number(req.query.page) || 1);
          const offset = (page - 1) * pageSize;

          try {
            // basic search by name or userUuid
            let sql = `SELECT userUuid, registrantUuid, fullName, bidLimit FROM registrants WHERE auctionUuid = ?`;
            const params = [auctionUuid];
            if (q) {
              sql += ` AND (fullName LIKE ? OR userUuid = ? OR registrantUuid = ?)`;
              params.push(`%${q}%`, q, q);
            }
            sql += ` ORDER BY fullName ASC LIMIT ${pageSize} OFFSET ${offset}`;

            const [rows] = await db.execute(sql, params);

            // prepare list of userUuids for batch Redis lookups
            const userUuids = rows.map(r => r.userUuid);
            let liveMap = {};
            if (userUuids.length) {
              try {
                liveMap = await fetchLiveFieldsForMany(auctionUuid, userUuids);
              } catch (err) {
                logger.warn('Failed to fetch live fields in batch:', err.message);
                liveMap = {};
              }
            }

            // format response
            const data = rows.map((r) => {
              const live = liveMap[r.userUuid] || { activeCount: 0, awaitingFlag: false, cachedLimit: null };
              return {
                userUuid: r.userUuid,
                registrantUuid: r.registrantUuid,
                fullName: r.fullName,
                bidLimit: r.bidLimit === null ? null : Number(r.bidLimit),
                activeCount: live.activeCount,
                awaitingDeposit: !!live.awaitingFlag,
                cachedLimit: live.cachedLimit // string or null
              };
            });

            res.json({ page, pageSize, data });
          } catch (err) {
            logger.error('GET registrants failed:', err);
            res.status(500).json({ error: 'internal_error' });
          }
        });

        // GET single registrant
        router.get('/auctions/:auctionUuid/registrants/:userUuid', async (req, res) => {
          const auctionUuid = req.params.auctionUuid;
          const userUuid = req.params.userUuid;

          try {
            const [rows] = await db.execute(
              `SELECT userUuid, registrantUuid, fullName, bidLimit FROM registrants WHERE auctionUuid = ? AND userUuid = ? LIMIT 1`,
              [auctionUuid, userUuid]
            );
            if (!rows || rows.length === 0) return res.status(404).json({ error: 'not_found' });

            const r = rows[0];

            // live fields
            const [activeCount, awaitingFlag, cachedLimit] = await Promise.all([
              redis.scard(`${activePrefix(auctionUuid)}${userUuid}`).catch(() => 0),
              redis.get(awaitingFlagKey(auctionUuid, userUuid)).catch(() => null),
              redis.hget(bidLimitHashPrefix(auctionUuid), userUuid).catch(() => null)
            ]);

            res.json({
              userUuid: r.userUuid,
              registrantUuid: r.registrantUuid,
              fullName: r.fullName,
              bidLimit: r.bidLimit === null ? null : Number(r.bidLimit),
              activeCount: Number(activeCount || 0),
              awaitingDeposit: !!awaitingFlag,
              cachedLimit: cachedLimit
            });
          } catch (err) {
            logger.error('GET registrant failed:', err);
            res.status(500).json({ error: 'internal_error' });
          }
        });

        // PATCH limit - update DB then write-through to Redis; optional enforce param: ?enforce=true
        router.patch('/auctions/:auctionUuid/registrants/:registrantUuid', async (req, res) => {

          const { auctionUuid, registrantUuid } = req.params;
          let { bidLimit } = req.body;
          const enforce = req.query.enforce === 'true';
          const adminUser = (req.user && req.user.username) ? req.user.username : 'admin'; // ensure you have auth middleware

          // normalize bidLimit
          if (bidLimit === '') bidLimit = null;
          if (bidLimit != null && typeof bidLimit !== 'number') {
            const n = Number(bidLimit);
            if (Number.isNaN(n)) return res.status(400).json({ error: 'invalid_bidLimit' });
            bidLimit = n;
          }
          if (bidLimit != null && bidLimit < 0) return res.status(400).json({ error: 'bidLimit_must_be_non_negative' });


          try {
            // lookup by registrantUuid (correct)
            const [rows] = await db.execute(
              `SELECT userUuid, bidLimit AS oldBidLimit FROM registrants WHERE auctionUuid=? AND registrantUuid=? LIMIT 1`,
              [auctionUuid, registrantUuid]
            );
            if (!rows || rows.length === 0) return res.status(404).json({ error: 'registrant_not_found' });

            const userUuid = rows[0].userUuid;
            const oldBidLimit = rows[0].oldBidLimit === null ? null : Number(rows[0].oldBidLimit);

            // 2) Update DB (durable)
            await db.execute(
              `UPDATE registrants SET bidLimit = ?, updatedAt = CURRENT_TIMESTAMP WHERE auctionUuid = ? AND userUuid = ?`,
              [bidLimit, auctionUuid, userUuid]
            );

            // 3) Update Redis cache (best-effort)
            const cacheVal = bidLimit == null ? '' : String(bidLimit);
            try {
              await redis.hset(bidLimitHashPrefix(auctionUuid), userUuid, cacheVal);
              // ensure mapping exists too (safe)
              await redis.hset(userToRegistrantHash(auctionUuid), userUuid, registrantUuid);
            } catch (err) {
              logger.warn('Redis cache update failed (DB is authoritative):', err.message);
            }

            // 4) Post-update logic: check activeCount and awaiting flag
            const activeCount = Number(await redis.scard(`${activePrefix(auctionUuid)}${userUuid}`).catch(() => 0));
            const awaitingKey = awaitingFlagKey(auctionUuid, userUuid);
            const awaitingFlag = await redis.get(awaitingKey);

            const notes = [];

            // If admin increased limit -> if awaiting flag present and now activeCount <= newLimit => unsuspend
            if (bidLimit != null && (oldBidLimit == null || Number(bidLimit) > Number(oldBidLimit))) {
              if (awaitingFlag && activeCount < Number(bidLimit)) {
                // Attempt to unsuspend (set to APPROVED / ACTIVE as appropriate)
                try {
                  await patchRegistrant(auctionUuid, registrantUuid, 'APPROVED');
                  await redis.del(awaitingKey);
                  notes.push('unsuspended');
                  try {
                    await recordAudit?.({  auctionUuid, userUuid, registrantUuid, action: 'unsuspend', actor: adminUser, meta: { activeCount, newLimit: bidLimit }  });
                  } catch (e) { logger.warn('audit failed for unsuspend:', e); }
                } catch (err) {
                  notes.push('unsuspend_failed');
                  logger.warn('Unsuspend API failed, enqueueing retry:', err.message);
                  await enqueueSuspensionRetry?.({ auctionUuid, userUuid, registrantUuid, action: 'unsuspend', err: String(err), retryCount: 0 });
                  try {
                    await recordAudit?.({
                      auctionUuid, userUuid, registrantUuid, action: 'unsuspend_failed', actor: adminUser, meta: { error: String(err) }
                    });
                  } catch (e) { /* ignore */ }
                }
              }
            }

            // If enforce=true and newLimit is lower than activeCount -> flag user awaiting deposit
            if (enforce && bidLimit != null && activeCount > Number(bidLimit)) {
              // Attempt enforcement: mark registrant AWATING_DEPOSIT and set awaiting flag
              try {
                await patchRegistrant(auctionUuid, registrantUuid, 'AWAITING_DEPOSIT');
                await redis.set(awaitingKey, '1');
                notes.push('enforcement_flagged');
                await recordAudit?.({
                  auctionUuid, userUuid, registrantUuid, action: 'awaiting_deposit', actor: adminUser, meta: { activeCount, newLimit: bidLimit }
                });
              } catch (err) {
                notes.push('enforce_failed');
                logger.warn('Enforce suspend failed; enqueueing retry:', err.message);
                await enqueueSuspensionRetry?.({ auctionUuid, userUuid, registrantUuid, action: 'awaiting_deposit', err: String(err), retryCount: 0 });
                await recordAudit?.({
                  auctionUuid, userUuid, registrantUuid, action: 'awaiting_deposit_failed', actor: adminUser, meta: { error: String(err) }
                }).catch(() => {});
              }
            }

            // Return updated view
            const response = {
              auctionUuid,
              userUuid,
              registrantUuid,
              oldBidLimit,
              newBidLimit: bidLimit === null ? null : Number(bidLimit),
              activeCount,
              awaitingDeposit: !!(awaitingFlag || (enforce && bidLimit != null && activeCount > Number(bidLimit))),
              notes
            };

            res.json(response);
          } catch (err) {
            logger.error('PATCH limit failed:', err);
            res.status(500).json({ error: 'internal_error' });
          }
        });

        // Expose helpers and router
        return {
          ensureBidLimitCached: (auctionUuid, userUuid, opts) => ensureBidLimitCached(redis, db, auctionUuid, userUuid, opts),
          router
        };
}

module.exports = { createLimitsService };
