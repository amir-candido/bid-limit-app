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

        const status = res[0];

        if (status === 'NOOP' || status === 'OK') {
          // normal path, nothing further
          return { status: 'OK', count: res[1] || null };
        }

        // handle ATLIMIT (the bidder has just reached their allowed count)
        if (status === 'ATLIMIT') {
          const activeCountStr = res[1] || '0';
          const registrantUuidFromCache = res[2] || '';
          const activeCount = Number(activeCountStr);

          // Resolve registrantUuid if missing
          let registrantUuid = registrantUuidFromCache || null;
          if (!registrantUuid) {
            try {
              registrantUuid = await redis.hget(userToRegistrantHash, newUserUuid);
            } catch (err) {
              console.warn('Redis failed to HGET userToRegistrant, will fall back to DB', err);
            }
          }

          if (!registrantUuid) {
            try {
              const [rows] = await db.execute(
                `SELECT registrantUuid FROM registrants WHERE auctionUuid = ? AND userUuid = ?`,
                [auctionUuid, newUserUuid]
              );
              registrantUuid = rows && rows[0] && rows[0].registrantUuid;
            } catch (err) {
              console.error('DB lookup for registrantUuid failed', err);
            }
          }

          if (!registrantUuid) {
            console.error('Unable to resolve registrantUuid for user', { auctionUuid, userUuid: newUserUuid });
            // Optionally enqueue an audit record for manual review
            await enqueueSuspensionRetry?.({ type: 'missingRegistrant', auctionUuid, userUuid: newUserUuid, bidUuid });
            return { status: 'NO_REGISTRANT' };
          }

          // Check "already awaiting deposit" flag to avoid duplicate PATCHes
          const awaitingFlagKey   = `auction:${auctionUuid}:userAwaitingDeposit:${newUserUuid}`;
          const alreadyFlag       = await redis.get(awaitingFlagKey);
          if (alreadyFlag) {
            console.log('Registrant already marked awaiting deposit; skipping', { auctionUuid, registrantUuid, newUserUuid });
            // Optionally record audit
            return { status: 'ALREADY_FLAGGED' };
          }

          // Call BidJS to set status to AWATING_DEPOSIT
          try {
            // patchRegistrant must accept (auctionUuid, registrantUuid, status). 
            // To see how "AWAITING DEPOSIT" is set, see route '/:auctionUuid/registrants/:userUuid/limit' in ./api
            const apiRes = await patchRegistrant(auctionUuid, registrantUuid, 'AWAITING_DEPOSIT');
            // Mark flag and write audit row
            await redis.set(awaitingFlagKey, '1'); // no TTL: persists until cleared by unsuspend logic
            //await recordSuspensionAudit?.(auctionUuid, newUserUuid, registrantUuid, 'awaiting_deposit', 'system', { apiResponse: apiRes });
            console.log('Marked registrant awaiting deposit', { auctionUuid, registrantUuid, newUserUuid, activeCount });
            await redis.sadd(`auction:${auctionUuid}:suspendedUsers`, newUserUuid);
            return { status: 'ATLIMIT_ACTION_TAKEN', activeCount };
          } catch (err) {
            console.error('patchRegistrant failed; enqueuing retry', err);
            console.error(`Failed to suspend bidder: auction=${auctionUuid}, user=${newUserUuid}`, err);
            await enqueueSuspensionRetry?.({ type: 'awaitingDeposit', auctionUuid, newUserUuid, registrantUuid, bidUuid, attempts: 0, lastError: String(err) });
            //await recordSuspensionAudit?.(auctionUuid, newUserUuid, registrantUuid, 'awaiting_deposit_failed', 'system', { error: String(err) });
            return { status: 'ENQUEUE_RETRY' };
          }
        }

        // if script returned other signals (EXCEEDED), handle them sensibly (treat as exceeded)
        if (status === 'EXCEEDED') {
          // fallback behavior: treat similarly to ATLIMIT but script logic should avoid this generally
          console.warn('Lua returned EXCEEDED for bid — this should be rare. Consider reviewing Lua logic.', { auctionUuid, listingUuid, bidUuid, res });
          // For safety, we won't call patchRegistrant here automatically; instead enqueue for manual review
          await enqueueSuspensionRetry?.({ type: 'exceededManual', auctionUuid, listingUuid, newUserUuid, bidUuid, detail: res });
          return { status: 'EXCEEDED_ENQUEUED' };
        }

        // default
        return { status: 'NO_ACTION' };
}



module.exports = { processNewHighestBid };
