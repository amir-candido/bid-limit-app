// src/services/audit.js
const { v4: uuidv4 } = require('uuid');

/**
 * createRecordAudit({ db, redis, options })
 * - db: mysql2/promise pool
 * - redis: ioredis client
 * - options:
 *    backlogKey (default 'audit:backlog')
 *    dlqKey (default 'audit:backlog:dlq')
 *    batchSize (default 50)
 */
function createRecordAudit({ db, redis, options = {} }) {
  if (!db) throw new Error('db is required');
  if (!redis) throw new Error('redis is required');

  const backlogKey = options.backlogKey || 'audit:backlog';
  const dlqKey = options.dlqKey || `${backlogKey}:dlq`;
  const batchSize = options.batchSize || 50;
  const logger = options.logger || console;

  /**
   * recordAudit(audit)
   * audit = {
   *   auctionUuid, userUuid, registrantUuid,
   *   eventType (string), actor (string), severity ('INFO'|'WARN'|'ERROR'),
   *   meta (object)
   * }
   *
   * Returns: Promise that resolves when DB insert succeeded or backloged.
   */
  async function recordAudit(audit) {
    const {
      auctionUuid = null,
      userUuid = null,
      registrantUuid = null,
      eventType,
      actor = 'system',
      severity = 'INFO',
      meta = {}
    } = audit;

    if (!eventType) throw new Error('eventType is required');

    const uuid = audit.uuid || uuidv4();

    const insertSql = `
      INSERT INTO audit_logs (uuid, auction_uuid, user_uuid, registrant_uuid, event_type, actor, severity, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE meta = VALUES(meta)
    `;
    const params = [
      uuid,
      auctionUuid || null,
      userUuid || null,
      registrantUuid || null,
      eventType,
      actor,
      severity,
      JSON.stringify(meta || {})
    ];

    try {
      await db.execute(insertSql, params);
      return { status: 'OK', uuid };
    } catch (err) {
      // DB failed: persist to Redis backlog for later retry
      logger.warn('recordAudit DB insert failed, writing to Redis backlog', err.message || err);
      const job = {
        uuid,
        auctionUuid: auctionUuid || null,
        userUuid: userUuid || null,
        registrantUuid: registrantUuid || null,
        eventType,
        actor,
        severity,
        meta: meta || {},
        createdAt: new Date().toISOString(),
        attempts: (audit.attempts || 0) + 1
      };

      try {
        // use LPUSH so worker can RPOP -> FIFO
        await redis.lpush(backlogKey, JSON.stringify(job));
        return { status: 'BACKLOGGED', uuid, attempts: job.attempts };
      } catch (e2) {
        // Fallback: if Redis also fails, log and throw (alerts should catch this)
        logger.error('recordAudit both DB and Redis backlog failed', e2);
        throw e2;
      }
    }
  }

  /**
   * processAuditBacklog - continuously drain backlog and insert into DB in batches.
   * - recommended to run as a separate worker process (pm2 process)
   */
  async function processAuditBacklog(opts = {}) {
    const {
      pollIntervalMs = 2000,
      batchSize: bs = batchSize,
      maxAttempts = 10,
      retryDelayMsOnFailure = 2000
    } = opts;

    while (true) {
      try {
        // Use LRANGE to get a batch, but better pattern: RPOPLPUSH to a processing list for reliability.
        // Simpler: BRPOP with timeout and single item processing in loop (safe and simple).
        const raw = await redis.brpop(backlogKey, 5); // [key, value] or null
        if (!raw) {
          // nothing, sleep a bit
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          continue;
        }

        // raw[1] is job JSON
        const jobJson = raw[1];
        let job;
        try {
          job = JSON.parse(jobJson);
        } catch (e) {
          // corrupt job: move to DLQ
          logger.error('Invalid audit job JSON; moving to DLQ', e);
          await redis.lpush(dlqKey, jobJson);
          continue;
        }

        // Try insert to DB
        try {
          const sql = `
            INSERT INTO audit_logs (uuid, auction_uuid, user_uuid, registrant_uuid, event_type, actor, severity, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE meta = VALUES(meta)
          `;
          const params = [
            job.uuid,
            job.auctionUuid || null,
            job.userUuid || null,
            job.registrantUuid || null,
            job.eventType,
            job.actor || 'system',
            job.severity || 'INFO',
            JSON.stringify(job.meta || {})
          ];
          await db.execute(sql, params);
          // inserted - go to next job
        } catch (dbErr) {
          logger.warn('Failed to insert audit job from backlog, will retry', dbErr.message || dbErr);
          job.attempts = (job.attempts || 0) + 1;
          if (job.attempts > maxAttempts) {
            logger.error('Audit job exceeded max attempts; moving to DLQ', job);
            await redis.lpush(dlqKey, JSON.stringify(job));
          } else {
            // Re-enqueue with small delay to avoid tight looping - push back to backlog tail
            await new Promise((r) => setTimeout(r, retryDelayMsOnFailure));
            await redis.lpush(backlogKey, JSON.stringify(job));
          }
        }
      } catch (outerErr) {
        logger.error('processAuditBacklog loop error', outerErr);
        // Sleep a bit on top-level errors to avoid tight crash loops
        await new Promise((r) => setTimeout(r, 5000));
      }
    } // while true
  }

  return {
    recordAudit,
    processAuditBacklog,
    backlogKey,
    dlqKey
  };
}

module.exports = { createRecordAudit };
