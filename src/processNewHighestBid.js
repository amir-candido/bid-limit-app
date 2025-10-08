// src/processNewHighestBid.js
const path                      = require('path');
const fs                        = require('fs');
const lua                       = fs.readFileSync(
  path.join(__dirname, 'scripts', 'atomic_swap_and_check.lua'),
  'utf8'
);
const {enqueueSuspensionRetry}  = require('./services/enqueueSuspensionRetry');
const { patchRegistrant }       = require('./bidjs-rest');
const { ensureBidLimitCached }  = require('./services/ensureBidLimitCached');
const { db }                    = require('./db');
const { redis }                 = require('./redis');


/**
 * processNewHighestBid - handle a bid that has become the new highest on a listing.
 *
 * Parameters (all passed via a single object for clarity & DI):
 *   - redis: ioredis client
 *   - db: mysql2/promise pool (for durable fallbacks/audit)
 *   - auctionUuid: string
 *   - listingUuid: string
 *   - newUserUuid: string
 *   - bidUuid: string
 *   - ensureBidLimitCached: function(redis, db, auctionUuid, userUuid) -> Promise<string> (returns cached limit string)
 *
 * Returns: { status: 'OK' } on normal success, or throws on fatal error.
 */
async function processNewHighestBid(opts) {

        const {
          auctionUuid,
          listingUuid,
          newUserUuid,
          bidUuid
        } = opts;

        if ( !auctionUuid || !listingUuid || !newUserUuid || !bidUuid) {
          throw new Error('processNewHighestBid missing required args');
        }

        const listingKey              = `auction:${auctionUuid}:listing:${listingUuid}:winner`;
        const activePrefix            = `auction:${auctionUuid}:userActiveLots:`; // script will append userUuid
        const bidLimitHash            = `auction:${auctionUuid}:userBidLimit`;
        const userToRegistrantHash    = `auction:${auctionUuid}:userToRegistrant`;

        // 0) Deduplicate by bidUuid
        const processedKey = `processedBid:${bidUuid}`;
        try {
          // Redis SET NX returns 'OK' when set, null if already exists
          const got = await redis.set(processedKey, '1', 'NX', 'EX', 300);
          if (!got) {
            // Already processed
            console.log('Skipping already-processed bid', { auctionUuid, listingUuid, bidUuid, newUserUuid });
            return { status: 'SKIPPED_DUP' };
          }
        } catch (err) {
          // Redis broken — enqueue and return; don't attempt atomic operation
          console.error('Redis error on dedupe set; enqueueing for retry', err);
          await enqueueSuspensionRetry?.({ type: 'pendingBid', auctionUuid, listingUuid, newUserUuid, bidUuid, err: String(err) });
          throw err;
        }

        // 1) Ensure bid limit is cached (so Lua sees correct limit)
        try {
          await ensureBidLimitCached(redis, db, auctionUuid, newUserUuid);
        } catch (err) {
          console.error('Error ensuring bid limit cache; enqueuing for retry', err);
          await enqueueSuspensionRetry?.({ type: 'pendingBid', auctionUuid, listingUuid, newUserUuid, bidUuid, err: String(err) });
          throw err;
        }

        // 2) Call Lua atomic script
        let res;
        try {
          // numKeys = 4, KEYS..., ARGV: newUserUuid, listingUuid
          res = await redis.eval(lua, 4, listingKey, activePrefix, bidLimitHash, userToRegistrantHash, newUserUuid, listingUuid);
        } catch (err) {
          console.error('Lua eval failed — enqueueing for retry', err);
          await enqueueSuspensionRetry?.({ type: 'pendingBid', auctionUuid, listingUuid, newUserUuid, bidUuid, err: String(err) });
          throw err;
        }

        // res expected shapes:
        // ['NOOP'] or ['OK','<count>'] or ['ATLIMIT','<count>','<registrantUuid>'] or ['EXCEEDED',...]
        if (!res || !Array.isArray(res)) {
          console.warn('Unexpected Lua result', { auctionUuid, listingUuid, bidUuid, res });
          return { status: 'NO_ACTION' };
        }

        const status             = res[0];
        const newActiveCountStr  = res[1] || '0';
        const newUserUuid        = res[2] || opts.newUserUuid;  // sanity fallback
        const lUuid              = res[3] || opts.listingUuid;
        const oldUserUuid        = res[4] || null;
        const oldActiveCountStr  = res[5] || '0';
        const newRegistrantUuid  = res[6] || null;
        const oldRegistrantUuid  = res[7] || null;

        const newActiveCount = Number(newActiveCountStr || 0);
        const oldActiveCount = Number(oldActiveCountStr || 0);

        const bidLimitHashKey   = `auction:${auctionUuid}:userBidLimit`;
        const awaitingKeyNew    = `auction:${auctionUuid}:userAwaitingDeposit:${newUserUuid}`;
        const awaitingKeyOld    = oldUserUuid ? `auction:${auctionUuid}:userAwaitingDeposit:${oldUserUuid}` : null;
        const suspendedSetKey   = `auction:${auctionUuid}:suspendedUsers`;

        async function maybeUnsuspend(usrUuid, regUuid, activeCount) {
          if (!usrUuid) return;
          try {
            const [awaitFlag, limitStr] = await Promise.all([
              redis.get(`auction:${auctionUuid}:userAwaitingDeposit:${usrUuid}`).catch(() => null),
              redis.hget(bidLimitHashKey, usrUuid).catch(() => null)
            ]);
            if (!awaitFlag) return;

            const limit = (limitStr === null || limitStr === '') ? null : Number(limitStr);
            const within = (limit === null) ? true : (activeCount < limit);
            if (!within) return;

            // resolve registrant if not provided
            let registrantUuid = regUuid;
            if (!registrantUuid) {
              registrantUuid = await redis.hget(`auction:${auctionUuid}:userToRegistrant`, usrUuid).catch(() => null);
              if (!registrantUuid) {
                const [rows] = await db.execute(
                  `SELECT registrantUuid FROM registrants WHERE auctionUuid=? AND userUuid=? LIMIT 1`,
                  [auctionUuid, usrUuid]
                );
                registrantUuid = rows?.[0]?.registrantUuid || null;
              }
            }
            if (!registrantUuid) return;

            try {
              await patchRegistrant(auctionUuid, registrantUuid, 'APPROVED');
              await redis.del(`auction:${auctionUuid}:userAwaitingDeposit:${usrUuid}`);
              await redis.srem(suspendedSetKey, usrUuid);
              // optional: audit
            } catch (e) {
              await enqueueSuspensionRetry?.({ type:'unsuspend', auctionUuid, userUuid: usrUuid, registrantUuid, err:String(e) });
            }
          } catch (e) {
            // log and continue
            console.warn('maybeUnsuspend error', e && e.message || e);
          }
        }

        if (status === 'NOOP' || status === 'OK') {
          // On any successful swap, try unsuspend the previous user if needed
          if (oldUserUuid) {
            await maybeUnsuspend(oldUserUuid, oldRegistrantUuid, oldActiveCount);
          }
          return { status, count: newActiveCount };
        }

        if (status === 'ATLIMIT') {
          // suspend new user if not already flagged
          const alreadyFlag = await redis.get(awaitingKeyNew);
          if (!alreadyFlag) {
            const registrantUuid = newRegistrantUuid ||
              await redis.hget(`auction:${auctionUuid}:userToRegistrant`, newUserUuid) ||
              (await (async () => {
                const [rows] = await db.execute(
                  `SELECT registrantUuid FROM registrants WHERE auctionUuid=? AND userUuid=? LIMIT 1`,
                  [auctionUuid, newUserUuid]
                );
                return rows?.[0]?.registrantUuid || null;
              })());

            if (registrantUuid) {
              try {
                await patchRegistrant(auctionUuid, registrantUuid, 'AWAITING_DEPOSIT');
                await redis.set(awaitingKeyNew, '1');
                await redis.sadd(suspendedSetKey, newUserUuid);
              } catch (e) {
                await enqueueSuspensionRetry?.({ type:'awaitingDeposit', auctionUuid, newUserUuid, registrantUuid, bidUuid, attempts:0, lastError:String(e) });
              }
            }
          }
          // also attempt unsuspend the old user on this swap
          if (oldUserUuid) {
            await maybeUnsuspend(oldUserUuid, oldRegistrantUuid, oldActiveCount);
          }
          return { status:'ATLIMIT_ACTION_TAKEN', activeCount: newActiveCount };
        }

        if (status === 'EXCEEDED') {
          // nothing committed; optional audit/enqueue
          await enqueueSuspensionRetry?.({ type:'exceededManual', auctionUuid, listingUuid, newUserUuid, bidUuid, detail: res });
          return { status:'EXCEEDED_ENQUEUED' };
        }

        return { status:'NO_ACTION' };

}



module.exports = { processNewHighestBid };
