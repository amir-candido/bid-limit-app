const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./bidlimit.db');

// Initialize schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registrants (
      auctionUuid TEXT,
      userId TEXT,
      bidLimit INTEGER,      
      currentTotal INTEGER,
      paused INTEGER DEFAULT 0,
      updatedAt TEXT,
      PRIMARY KEY (auctionUuid, userId)
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
           (auctionUuid, userId, bidLimit, currentTotal, paused, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(auctionUuid, userId) DO UPDATE SET
           bidLimit=excluded.bidLimit,
           currentTotal=excluded.currentTotal,
           paused=excluded.paused,
           updatedAt=excluded.updatedAt`,
        [
          rec.auctionUuid,
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

  markPaused(auc, regUuid) {
    return this.upsert({ auctionUuid: auc, userId: regUuid, paused: true, bidLimit: null, currentTotal: 0, updatedAt: new Date().toISOString() });
  },

  markUnpaused(auc, regUuid) {
    return this.upsert({ auctionUuid: auc, userId: regUuid, paused: false, bidLimit: null, currentTotal: 0, updatedAt: new Date().toISOString() });
  },
};
