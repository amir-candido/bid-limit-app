const express = require('express');
const db = require('./db');
const { enforceLimitsForAuction } = require('./services');
const router = express.Router();

// List all registrants for an auction
router.get('/:auctionId/limits', async (req, res) => {
  const data = await db.getAllForAuction(req.params.auctionId);
  res.json(data);
});

// Update a registrant’s bidLimit
router.patch('/:auctionId/registrants/:userId', express.json(), async (req, res) => {
  const bidLimit = req.body.bidLimit;  // integer or null
  await db.upsert({
    auctionId: req.params.auctionId,
    userId: req.params.userId,
    bidLimit,
    currentTotal: 0,
    paused: false,
    updatedAt: new Date().toISOString(),
  });
  // Immediately re‑evaluate limits
  await enforceLimitsForAuction(req.params.auctionId);
  res.sendStatus(204);
});

router.get('/auctions', async (req, res) => {
  const data = await db.getAllAuctions();
  res.json(data);
});

module.exports = router;
