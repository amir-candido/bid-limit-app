const express = require('express');
const db = require('./db');
const { enforceLimitsForAuction } = require('./services');
const router = express.Router();

// List all registrants for an auction
router.get('/:auctionUuid/limits', async (req, res) => {
  const data = await db.getAllForAuction(req.params.auctionUuid);
  res.json(data);
});

// Update a registrant’s bidLimit
router.patch('/:auctionUuid/registrants/:registrantUuid', express.json(), async (req, res) => {
  const bidLimit = req.body.bidLimit;  // integer or null
  await db.upsert({
    auctionUuid: req.params.auctionUuid,
    registrantUuid: req.params.registrantUuid,
    bidLimit,
    currentTotal: 0,
    paused: false,
    updatedAt: new Date().toISOString(),
  });
  // Immediately re‑evaluate limits
  await enforceLimitsForAuction(req.params.auctionUuid);
  res.sendStatus(204);
});

module.exports = router;
