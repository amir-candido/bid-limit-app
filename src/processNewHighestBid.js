const fs = require('fs');
const lua = fs.readFileSync('./atomic_swap_and_check.lua', 'utf8');
const { patchRegistrant } = require('./bidjs-rest'); // REST helper

async function processNewHighestBid(redis, auctionUuid, listingUuid, newUserUuid) {

    const listingKey            = `auction:${auctionUuid}:listing:${listingUuid}:winner`;
    const activePrefix          = `auction:${auctionUuid}:userActiveLots:`; // note: script will append userUuid
    const bidLimitHash          = `auction:${auctionUuid}:userBidLimit`;
    const userToRegistrantHash  = `auction:${auctionUuid}:userToRegistrant`;

    const processedKey          = `processedBid:${bidUuid}`;
    const got                   = await redis.set(processedKey, '1', 'NX', 'EX', 300); // 5 min
    if (!got) {
     return; // already processed
    }  

    // numKeys = 4, then the 4 KEYS, then ARGV (newUserUuid, listingUuid)
    const res = await redis.eval(lua, 4, listingKey, activePrefix, bidLimitHash, userToRegistrantHash, newUserUuid, listingUuid);
    // res is an array: e.g. ['OK','2'] or ['EXCEEDED','3','6dabb56d...']
    
    if (!res || res[0] !== 'ATLIMIT') {return; }// nothing more to do
    
    const [, activeCountStr, registrantUuidFromCache] = res;
    const exceededCount = Number(activeCountStr);


    let registrantUuid = registrantUuidFromCache || null;
    if (!registrantUuid) {
        registrantUuid = await redis.hget(`auction:${auctionUuid}:userToRegistrant`, newUserUuid);
    }
    if (!registrantUuid) {
            // final fallback: durable DB
            const [rows] = await db.execute(
                `SELECT registrantUuid FROM registrants WHERE auctionUuid = ? AND userUuid = ?`,
                [auctionUuid, newUserUuid]
            );
            registrantUuid = rows[0] && rows[0].registrantUuid;
    }

    if (!registrantUuid) {
    // cannot find registrantUuid — log and enqueue for manual review
    }

    const suspendedFlagKey = `auction:${auctionUuid}:userSuspended:${newUserUuid}`;
    const alreadySuspended = await redis.get(suspendedFlagKey);
    if (alreadySuspended) {
        // Already suspended recently — just record event and return
        //await recordSuspensionAudit(..., 'already_suspended');
        return;
    }

    try {
        const apiRes = await patchRegistrant(auctionUuid, registrantUuid);
        // success: mark redis flag, persist audit row
        await redis.set(suspendedFlagKey, '1');
        await recordSuspensionAudit(auctionUuid, newUserUuid, registrantUuid, 'suspend', 'system', apiRes.data);
    } catch (err) {
        // API failed — push to retry queue and persist failed attempt for visibility
        await enqueueSuspensionRetry({ auctionUuid, newUserUuid, registrantUuid, reason: err.message });
        await recordSuspensionAudit(auctionUuid, newUserUuid, registrantUuid, 'suspend', 'system', { error: err.message });
    }

}

module.exports = { processNewHighestBid };
