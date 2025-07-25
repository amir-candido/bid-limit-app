const schedule = require('node-schedule');
const { ACTIVE_AUCTIONS } = require('./config');
const { enforceLimitsForAuction } = require('./services');

function startScheduler() {
  // every minute
  schedule.scheduleJob('*/1 * * * *', async () => {
    for (const auctionId of ACTIVE_AUCTIONS) {
      try {
        await enforceLimitsForAuction(auctionId);
      } catch (err) {
        console.error(`Error polling auction ${auctionId}:`, err);
      }
    }
  });
}

module.exports = { startScheduler };
