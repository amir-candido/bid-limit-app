/**
 * Process jobs whose scheduled retry time has arrived.
 * @param {object} redis - Redis client
 * @param {function} suspensionHandler - Function that retries the actual suspension
 * @param {object} [options]
 * @param {string} [options.queueKey='suspension:retryZset'] - Redis sorted set key
 * @param {number} [options.pollIntervalMs=5000] - How often to poll for ready jobs
 */
async function processSuspensionRetries(redis, suspensionHandler, options = {}) {
  const {
    queueKey = 'suspension:retryZset',
    pollIntervalMs = 5000
  } = options;

  while (true) {
    const now = Date.now();

    // Fetch jobs ready for processing (score <= now)
    const jobs = await redis.zrangebyscore(queueKey, 0, now, 'LIMIT', 0, 5);

    if (!jobs.length) {
      await new Promise(res => setTimeout(res, pollIntervalMs));
      continue;
    }

    for (const jobJson of jobs) {
      let job;
      try {
        job = JSON.parse(jobJson);
      } catch (err) {
        console.error('Invalid job JSON in retry queue:', err);
        await redis.zrem(queueKey, jobJson); // Remove corrupt job
        continue;
      }

      try {
        console.log(`Retrying suspension: auction=${job.auctionUuid}, user=${job.newUserUuid}, attempt=${job.retryCount}`);
        await suspensionHandler(job);

        // Remove from queue after success
        await redis.zrem(queueKey, jobJson);
      } catch (err) {
        console.warn(`Suspension retry failed: auction=${job.auctionUuid}, user=${job.newUserUuid}`, err);
        await redis.zrem(queueKey, jobJson); // Remove old entry before re-enqueueing
        await enqueueSuspensionRetry(redis, { ...job, err: String(err) });
      }
    }
  }
}

module.exports = { processSuspensionRetries };
