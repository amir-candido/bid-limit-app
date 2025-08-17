/**
 * Ensure bid limit for a given auction+user is cached in Redis.
 * @param {object} redis - Redis client
 * @param {object} db - MySQL connection/pool
 * @param {string} auctionUuid
 * @param {string} userUuid
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false] - If true, reload from DB regardless of cache
 * @param {number} [options.ttlSeconds=3600] - Optional TTL for Redis entry
 * @returns {Promise<string>} - The bid limit as a string ('' if unlimited/unknown)
 */
async function ensureBidLimitCached(redis, db, auctionUuid, userUuid, options = {}) {

  const { forceRefresh  = false, ttlSeconds = 3600 } = options;
  const bidLimitHash    = `auction:${auctionUuid}:userBidLimit`;

  try {
    // If not forcing refresh, check Redis first
    if (!forceRefresh) {
      const cachedVal = await redis.hget(bidLimitHash, userUuid);
      if (cachedVal !== null) {
        return cachedVal; // Already cached
      }
    }

    // Fetch from MySQL
    const [rows] = await db.execute(
      `SELECT bidLimit FROM registrants WHERE auctionUuid = ? AND userUuid = ? LIMIT 1`,
      [auctionUuid, userUuid]
    );

    // Determine final value to store
    const bidLimitVal = (rows.length && rows[0].bidLimit != null)
      ? String(rows[0].bidLimit)
      : ''; // '' = unlimited or not set

    // Write to Redis (with optional TTL to prevent stale cache)
    await redis.hset(bidLimitHash, userUuid, bidLimitVal);

    // Optional: expire whole hash after some time to avoid stale data
    if (ttlSeconds > 0) {
      await redis.expire(bidLimitHash, ttlSeconds);
    }

    return bidLimitVal;

  } catch (err) {
    console.error(`Failed to ensure bidLimit cache for ${auctionUuid}:${userUuid}`, err);
    // Optional: Fallback could return '' or throw depending on policy
    throw err;
  }
}


module.exports = { ensureBidLimitCached };