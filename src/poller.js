const schedule = require('node-schedule');
const {  fetchAllAuctionUUIDs }= require('./bidjs-rest');
const { enforceLimitsForAuction } = require('./services');

async function startScheduler() {

  const allAuctionUUID = await fetchAllAuctionUUIDs();

  schedule.scheduleJob('*/1 * * * *', async () => {
    for (const auctionUUId of allAuctionUUID) {
      try {
        await enforceLimitsForAuction(auctionUUId);
      } catch (err) {
        console.error(`Error polling auction ${auctionUUId}:`, err);
      }
    }
  });
}

module.exports = { startScheduler };
