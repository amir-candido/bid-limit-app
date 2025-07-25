const axios = require('axios');
const db = require('./db');
const { BIDJS_BASE, API_KEY } = require('./config');

async function enforceLimitsForAuction(auctionUuid) {
  // 1) Fetch the Auction Report
  const resp = await axios.get(
    `${BIDJS_BASE}/auctions/${auctionUuid}/report`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  );
  const report = resp.data;

  // 2) Sum winning bids per registrant
  const totals = {};
  (report.winningBids || []).forEach(bid => {
    totals[bid.registrantUuid] = (totals[bid.registrantUuid] || 0) + bid.amount;
  });

  // 3) Enforce limits
  const regs = await db.getAllForAuction(auctionUuid);
  for (let reg of regs) {
    const total = totals[reg.registrantUuid] || 0;
    const overLimit = reg.bidLimit !== null && total > reg.bidLimit;
    // Update DB record
    await db.upsert({
      auctionUuid,
      registrantUuid: reg.registrantUuid,
      bidLimit: reg.bidLimit,
      currentTotal: total,
      paused: overLimit,
      updatedAt: new Date().toISOString(),
    });

    // 4) Call BidJS Registrant API if status changed
    if (overLimit && !reg.paused) {
      await axios.patch(
        `${BIDJS_BASE}/registrants/${reg.registrantUuid}`,
        { status: 'DepositRequested' },
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
    } else if (!overLimit && reg.paused) {
      await axios.patch(
        `${BIDJS_BASE}/registrants/${reg.registrantUuid}`,
        { status: 'Active' },
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
    }
  }
}

module.exports = { enforceLimitsForAuction };
