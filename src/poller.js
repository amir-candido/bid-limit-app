const schedule = require('node-schedule');
const fetchActiveAuctions = require('./getActiveAuctions');
const { enforceLimitsForAuction } = require('./services');

async function startScheduler() {
  const activeAuctionIds = await fetchActiveAuctions();
  console.log('🎯 Active Auctions:', activeAuctionIds);

  // every minute
  schedule.scheduleJob('*/1 * * * *', async () => {
    for (const auctionId of activeAuctionIds) {
      try {
        await enforceLimitsForAuction(auctionId);
      } catch (err) {
        console.error(`Error polling auction ${auctionId}:`, err);
      }
    }
  });
}

module.exports = { startScheduler };
