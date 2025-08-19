// src/services/syncAuctions.js
const { fetchAllAuctions } = require('../bidjs-rest');

async function syncAuctions({ db  }) {
  try {
    const auctions = await fetchAllAuctions();
    console.log(`Fetched ${auctions.length} auctions from BidJS`);

    for (const a of auctions) {
      const { uuid, title } = a;
      const sql = `
        INSERT INTO auctions (auctionUuid, title)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          updatedAt = CURRENT_TIMESTAMP
      `;
      await db.query(sql, [uuid, title || null]);
    }
    console.log(`Auctions table synced (${auctions.length} records)`);
  } catch (err) {
    console.log('Failed to sync auctions:', err);
    throw err;
  }
}

module.exports = { syncAuctions };
