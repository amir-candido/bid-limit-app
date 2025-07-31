const sqlite3 = require('sqlite3').verbose();

// Open (or create) the SQLite database file
db = new sqlite3.Database('./bidlimit.db', err => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
});

// Ensure the "registrants" table exists
const initSchema = () => {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS registrants (
      auctionId     TEXT       NOT NULL,
      auctionUuid   TEXT,
      userId        TEXT       NOT NULL,
      fullname      TEXT,
      email         TEXT,
      bidLimit      INTEGER,
      currentTotal  INTEGER    DEFAULT 0,
      paused        INTEGER    DEFAULT 0,
      updatedAt     TEXT       NOT NULL,
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

const initUsersSchema = () => {
  const createTableSql = `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    passwordHash  TEXT NOT NULL,
    role          TEXT DEFAULT 'admin',
    createdAt     TEXT NOT NULL,
    updatedAt     TEXT NOT NULL
  )`;

  db.run(createTableSql, err => {
    if (err) {
      console.error('Failed to create users table:', err.message);
      process.exit(1);
    }
  });
};

initUsersSchema();

module.exports = {
  /**
   * Get all registrants for a given auction.
   * @param {string} auctionId
   * @returns {Promise<Array<Object>>}
   */
  getAllForAuction(auctionId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT auctionId, auctionUuid, userId, fullname, email, bidLimit, currentTotal, paused, updatedAt
         FROM registrants WHERE auctionId = ?`,
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
          (auctionId, auctionUuid, userId, fullname, email, bidLimit, currentTotal, paused, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(auctionId, userId) DO UPDATE SET
          auctionUuid  = excluded.auctionUuid,
          fullname     = excluded.fullname,
          email        = excluded.email,
          bidLimit     = excluded.bidLimit,
          currentTotal = excluded.currentTotal,
          paused       = excluded.paused,
          updatedAt    = excluded.updatedAt
      `;

      db.run(
        sql,
        [
          rec.auctionId,
          rec.auctionUuid || null,
          rec.userId,
          rec.fullname || null,
          rec.email || null,
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
      auctionUuid: null,
      fullname: null,
      email: null,
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
      auctionUuid: null,
      fullname: null,
      email: null,
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
