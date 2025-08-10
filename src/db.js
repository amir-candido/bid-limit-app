// src/db.js
const sqlite3 = require('sqlite3').verbose();

// Open (or create) the SQLite database file
const db = new sqlite3.Database('bidlimit.db', err => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
});

function getRegistrant(auction, user) {
  return new Promise((res, rej) => {
    db.get(
      `SELECT bidLimit, status
         FROM registrants
        WHERE auctionUuid = ? AND registrantUuid = ?`,
      [auction, user], (err, row) => err ? rej(err) : res(row)
    );
  });
}
function setRegistrant(auction, user, { limit, status }) {
  return new Promise((res, rej) => {
    db.run(
      `INSERT INTO registrants(auctionUuid,userUuid,bidLimit,status)
         VALUES(?,?,?,?)
       ON CONFLICT(auctionUuid,userUuid) DO UPDATE
         SET bidLimit = excluded.bidLimit,
             status   = excluded.status`,
      [auction, user, limit, status], err => err ? rej(err) : res()
    );
  });
}

// 2. Current highest & active‐lot count
function upsertCurrentHighest(auction, lot, bid, user) {
  return new Promise((res, rej) => {
    db.run(
      `INSERT INTO current_highest(auctionUuid,listingUuid,bidUuid,userUuid)
         VALUES(?,?,?,?)
       ON CONFLICT(auctionUuid,listingUuid) DO UPDATE
         SET bidUuid  = excluded.bidUuid,
             userUuid = excluded.userUuid`,
      [auction, lot, bid, user], err => err ? rej(err) : res()
    );
  });
}
function getCurrentHighest(auction, lotId) {
  return new Promise((res, rej) => {
    db.get(
      `SELECT bidUuid, userUuid
         FROM current_highest
        WHERE auctionUuid = ? AND listingUuid = ?`,
      [auction, lotId], (err, row) => err ? rej(err) : res(row)
    );
  });
}
function countActiveLots(auction, user) {
  return new Promise((res, rej) => {
    db.get(
      `SELECT COUNT(*) AS cnt
         FROM current_highest
        WHERE auctionUuid = ? AND userUuid = ?`,
      [auction, user], (err, row) => err ? rej(err) : res(row.cnt)
    );
  });
}

module.exports = {
  getRegistrant, setRegistrant,
  upsertCurrentHighest, getCurrentHighest,
  countActiveLots,
};
