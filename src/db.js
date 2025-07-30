const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./bidlimit.db');

// Initialize schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registrants (
      auctionId TEXT,
      userId TEXT,
      bidLimit INTEGER,      
      currentTotal INTEGER,
      paused INTEGER DEFAULT 0,
      updatedAt TEXT,
      PRIMARY KEY (auctionId, userId)
    )
  `);
});

module.exports = {
  
  getAllForAuction(auc) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM registrants WHERE auctionId = ?`,
        [auc],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });
  },

  upsert(rec) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO registrants
           (auctionId, userId, bidLimit, currentTotal, paused, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(auctionId, userId) DO UPDATE SET
           bidLimit=excluded.bidLimit,
           currentTotal=excluded.currentTotal,
           paused=excluded.paused,
           updatedAt=excluded.updatedAt`,
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

  getAllAuctions() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT DISTINCT auctionId
         FROM registrants
         ORDER BY auctionId`,
        [],
        (err, rows) => {
          if (err) return reject(err);
          // rows is like [ { auctionId: '8095' }, { auctionId: '8123' }, … ]
          const auctions = rows.map(r => r.auctionId);
          resolve(auctions);
        }
      );
    });
  },
},  

  markPaused(auc, regUuid) {
    return this.upsert({ auctionId: auc, userId: regUuid, paused: true, bidLimit: null, currentTotal: 0, updatedAt: new Date().toISOString() });
  },

  markUnpaused(auc, regUuid) {
    return this.upsert({ auctionId: auc, userId: regUuid, paused: false, bidLimit: null, currentTotal: 0, updatedAt: new Date().toISOString() });
  },
};
