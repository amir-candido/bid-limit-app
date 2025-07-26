const db = require('./db');
const bidjsClient = require('./bidjsClient');

async function enforceLimitsForAuction(auctionUuid) {
  // 1) Fetch the Auction Report
  const resp = await bidjsClient.get(`/auctions/${auctionUuid}/report`);
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
      await bidjsClient.patch(`/registrants/${reg.registrantUuid}`, {
        status: 'DepositRequested',
      });
    } else if (!overLimit && reg.paused) {
      await bidjsClient.patch(`/registrants/${reg.registrantUuid}`, {
        status: 'Active',
      });
    }
  }
}

module.exports = { enforceLimitsForAuction };
