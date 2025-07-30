const sqlite3 = require('sqlite3').verbose();

// Open (or create) the SQLite database file
const db = new sqlite3.Database('./bidlimit.db', err => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
});

// Ensure the "registrants" table exists
const initSchema = () => {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS registrants (
      auctionId    TEXT       NOT NULL,
      userId       TEXT       NOT NULL,
      bidLimit     INTEGER,
      currentTotal INTEGER    DEFAULT 0,
      paused       INTEGER    DEFAULT 0,
      updatedAt    TEXT       NOT NULL,
      PRIMARY KEY (auctionId, userId)
    )
  `;

  db.run(createTableSql, err => {
    if (err) {
      console.error('Failed to create registrants table:', err.message);
      process.exit(1);
    }
  });
};

initSchema();

module.exports = {
  /**
   * Get all registrants for a given auction.
   * @param {string} auctionId
   * @returns {Promise<Array<Object>>}
   */
  getAllForAuction(auctionId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM registrants WHERE auctionId = ?`,
        [auctionId],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });
  },

  /**
   * Insert or update a registrant record.
   * @param {Object} rec
   */
  upsert(rec) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO registrants
          (auctionId, userId, bidLimit, currentTotal, paused, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(auctionId, userId) DO UPDATE SET
          bidLimit     = excluded.bidLimit,
          currentTotal = excluded.currentTotal,
          paused       = excluded.paused,
          updatedAt    = excluded.updatedAt
      `;

      db.run(
        sql,
        [
          rec.auctionId,
          rec.userId,
          rec.bidLimit,
          rec.currentTotal,
          rec.paused ? 1 : 0,
          rec.updatedAt,
        ],
        err => (err ? reject(err) : resolve())
      );
    });
  },

  /**
   * Get unique list of all auction IDs.
   * @returns {Promise<Array<string>>}
   */
  getAllAuctions() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT DISTINCT auctionId FROM registrants ORDER BY auctionId`,
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.map(r => r.auctionId));
        }
      );
    });
  },

  /**
   * Pause a registrant (mark paused = 1).
   */
  markPaused(auctionId, userId) {
    return this.upsert({
      auctionId,
      userId,
      bidLimit: null,
      currentTotal: 0,
      paused: true,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Unpause a registrant (mark paused = 0).
   */
  markUnpaused(auctionId, userId) {
    return this.upsert({
      auctionId,
      userId,
      bidLimit: null,
      currentTotal: 0,
      paused: false,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Close the database connection.
   */
  close() {
    db.close(err => {
      if (err) {
        console.error('Error closing database:', err.message);
      }
    });
  },
};
