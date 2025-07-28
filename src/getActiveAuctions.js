
const { BIDJS_BASE, Client_ID, Auctioneer_ID } = require('./config');
const bidjsClient = require('./bidjsClient');

async function fetchActiveAuctions() {
  try {
    const { data } = await bidjsClient.get(`${BIDJS_BASE}/auction-mgt/bdxapi/auctions/${Auctioneer_ID}?clientId=${Client_ID}`);

    console.log("Raw data:", data);
    console.log("Raw data.models:", data.models);
    console.log("Raw data.models.auctionReferenceModel:", data.models.auctionReferenceModel);
    console.log("Raw data.models.auctionReferenceModel.collection:", data.models.auctionReferenceModel.collection);
    // Drill down to the actual array:
    const auctions = data.models?.auctionReferenceModel?.collection || [];
    //console.log("All auctions:", auctions);

    // If your goal is to only run on currently live auctions:
    const active = auctions.filter(a => a.live);

    //console.log("Filtered live auctions:", active);

    // Return only the IDs (or uuids if you prefer):
    return active.map(a => a.id);
  } catch (err) {
    console.error('getActiveAuctions.js: Failed to fetch active auctions:', err.message);
    return [];
  }
}

module.exports = fetchActiveAuctions;
