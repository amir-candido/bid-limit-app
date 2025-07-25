const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./bidlimit.db');

// Initialize schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registrants (
      auctionUuid TEXT,
      registrantUuid TEXT,
      bidLimit INTEGER,     -- NULL = unlimited
      currentTotal INTEGER,
      paused INTEGER DEFAULT 0,
      updatedAt TEXT,
      PRIMARY KEY (auctionUuid, registrantUuid)
    )
  `);
});

module.exports = {
  getAllForAuction(auc) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM registrants WHERE auctionUuid = ?`,
        [auc],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });
  },

  upsert(rec) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO registrants
           (auctionUuid, registrantUuid, bidLimit, currentTotal, paused, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(auctionUuid, registrantUuid) DO UPDATE SET
           bidLimit=excluded.bidLimit,
           currentTotal=excluded.currentTotal,
           paused=excluded.paused,
           updatedAt=excluded.updatedAt`,
        [
          rec.auctionUuid,
          rec.registrantUuid,
          rec.bidLimit,
          rec.currentTotal,
          rec.paused ? 1 : 0,
          rec.updatedAt,
        ],
        err => (err ? reject(err) : resolve())
      );
    });
  },

  markPaused(auc, regUuid) {
    return this.upsert({ auctionUuid: auc, registrantUuid: regUuid, paused: true, bidLimit: null, currentTotal: 0, updatedAt: new Date().toISOString() });
  },

  markUnpaused(auc, regUuid) {
    return this.upsert({ auctionUuid: auc, registrantUuid: regUuid, paused: false, bidLimit: null, currentTotal: 0, updatedAt: new Date().toISOString() });
  },
};
