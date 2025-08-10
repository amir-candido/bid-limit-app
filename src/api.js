// src/api.js
const express = require('express');
const router = express.Router();
const cache   = require('./bidjsSocket').registrantCache;
const {
  getRegistrant,       // { bidLimit, status }
  countActiveLots      // integer
} = require('./db');
const { fetchAllAuctionUUIDs } = require('./bidjs-rest') ;


// GET /auctions/:auctionId/registrants src/bidjs-rest.js
router.get('/auctions/:auctionId/registrants', async (req, res) => {
    const auctionId = Number(req.params.auctionId);

    console.log('auctionId:', auctionId);

    console.log('[DEBUG] Current cache keys:', [...cache.keys()]);

    console.log('Current cache contents:');
    for (const [auctionId, regMap] of cache.entries()) {
      console.log(`Auction: ${auctionId}`);
      for (const [uuid, { name, email }] of regMap.entries()) {
        console.log(`  - ${uuid}: ${name}, ${email}`);
      }
    }  

    console.log('🔍 Lookup auctionId:', JSON.stringify(auctionId), `(type=${typeof auctionId})`);
    console.log('🧠 Cache keys:', JSON.stringify([...cache.keys()]));

    // 1. Grab the profile map for this auction
    const profileMap = cache.get(auctionId);
    if (!profileMap) {
      return res.status(404).json({ error: 'No such auction or cache uninitialized' });
    }

    // 2. For each registrantUuid in the cache, fetch DB info
    const result = [];
    for (const [registrantUuid, { name, email }] of profileMap) {
      const reg       = await getRegistrant(auctionId, registrantUuid);
      const activeCnt = await countActiveLots(auctionId, registrantUuid);

      if (!reg) {
        console.warn(`No DB record found for auctionId=${auctionId}, registrantUuid=${registrantUuid}`);
      }      

      result.push({
        registrantUuid,
        name,
        email,
        bidLimit:   reg?.bidLimit ?? null,
        status:     reg?.status ?? 'APPROVED',
        activeLots: activeCnt
      });
    }

    // 3. Return the merged array
    res.json(result);
});


router.get('/auctions', async (req, res) => {
  try {
    const auctionIds = await fetchAllAuctionUUIDs();
    return res.json(auctionIds);
  } catch (err) {
    console.error('❌ Error fetching auctions:', err);
    return res.status(500).json({ error: 'Failed to load auctions' });
  }
});

// Update a registrant’s bidLimit
router.patch('/auctions/:auctionId/registrants/:registrantUuid', express.json(), async (req, res) => {
  const { auctionId, registrantUuid } = req.params;
  const bidLimit = req.body.bidLimit;

  await db.upsert({
    auctionId,
    registrantUuid,    
    bidLimit,
    currentTotal: 0,
    paused: false,
    updatedAt: new Date().toISOString(),
  });

  await enforceLimitsForAuction(auctionId);
  res.sendStatus(204);
});



module.exports = router;
