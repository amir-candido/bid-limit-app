/**
 * Enqueue a failed suspension attempt for later retry with exponential backoff.
 * @param {object} redis - Redis client
 * @param {object} jobData - Job details (must be JSON serializable)
 * @param {object} [options]
 * @param {string} [options.queueKey='suspension:retryZset'] - Redis sorted set key
 * @param {number} [options.maxRetries=5] - Maximum attempts before moving to DLQ
 * @param {number} [options.baseDelayMs=10000] - Initial retry delay in milliseconds
 * @returns {Promise<void>}
 */
async function enqueueSuspensionRetry(redis, jobData, options = {}) {
  const {
    queueKey = 'suspension:retryZset',
    maxRetries = 5,
    baseDelayMs = 10000
  } = options;

  try {
    const retryCount = (jobData.retryCount || 0) + 1;
    const now = Date.now();

    const job = {
      ...jobData,
      retryCount,
      lastError: jobData.err || 'Unknown error',
      lastAttemptAt: new Date().toISOString()
    };

    // Exponential backoff formula: delay = baseDelayMs * 2^(retryCount - 1)
    const delay = baseDelayMs * Math.pow(2, retryCount - 1);
    const scheduledAt = now + delay;

    // If retries exceeded, send to DLQ
    if (retryCount > maxRetries) {
      const dlqKey = `${queueKey}:deadLetter`;
      await redis.lpush(dlqKey, JSON.stringify(job));
      console.warn(`Moved to DLQ: auction=${job.auctionUuid}, user=${job.newUserUuid}`);
      return;
    }

    // Add to retry sorted set with scheduled time as score
    await redis.zadd(queueKey, scheduledAt, JSON.stringify(job));

    console.info(`Retry scheduled in ${Math.round(delay / 1000)}s (attempt ${retryCount}) for auction ${job.auctionUuid}, user ${job.newUserUuid}`);
  } catch (err) {
    console.error('Failed to enqueue suspension retry:', err);
    // Optional: log to file or alert
  }
}

module.exports = { enqueueSuspensionRetry };
