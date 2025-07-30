// src/seed.js
const db = require('./db');
const { v4: uuid } = require('uuid');

async function seed() {
  // Demo auctions & registrants
  const demo = [
    { auctionUuid: 'demo-auction-1', userId: uuid(), bidLimit: 2 },
    { auctionUuid: 'demo-auction-1', userId: uuid(), bidLimit: 3 },
    { auctionUuid: 'demo-auction-2', userId: uuid(), bidLimit: null }, // unlimited
    { auctionUuid: 'demo-auction-2', userId: uuid(), bidLimit: 1 },
  ];

  for (let rec of demo) {
    await db.upsert({
      auctionUuid:   rec.auctionUuid,
      userId: rec.userId,
      bidLimit:      rec.bidLimit,
      currentTotal:  0,
      paused:        false,
      updatedAt:     new Date().toISOString(),
    });
    console.log(`✔️ Seeded ${rec.auctionUuid} / ${rec.userId} (limit=${rec.bidLimit})`);
  }
}

seed()
  .then(() => {
    console.log('🎉 Seeding complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  });
