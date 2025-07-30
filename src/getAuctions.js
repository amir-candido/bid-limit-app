
const { BIDJS_BASE, Client_ID, Auctioneer_ID } = require('./config');
const bidjsClient = require('./bidjsClient');


async function getAuctionReport(auctionId) {
  try {
    const { data } = await bidjsClient.get(`${BIDJS_BASE}/auction-mgt/bdxapi/reporting/auction/${auctionId}/category?clientId=${Client_ID}`);
    console.log("auctionReport data:", data);
    const auctionReport = data.models?.auctionReferenceModel?.collection || [];
    console.log("auctionReport:", auctionReport);
    return auctionReport;
  } catch (err) {
    console.error('getAllAuctions.js getAuctionReport: Failed to fetch Auction Report:', err.message);
    return [];
  }
}

async function fetchActiveAuctions() {
  try {
    const auctions = await fetchAllAuctions();
    return auctions.filter(a => a.live).map(a => a.id);
  } catch (err) {
    console.error('getActiveAuctions.js fetchActiveAuctions: Failed to fetch active auctions:', err.message);
    return [];
  }
}

async function fetchAllAuctions() {
  try {
    const { data } = await bidjsClient.get(`${BIDJS_BASE}/auction-mgt/bdxapi/auctions/${Auctioneer_ID}?clientId=${Client_ID}`);
    return data.models?.auctionReferenceModel?.collection || [];
  } catch (err) {
    console.error('getAllAuctions.js fetchAllAuctions: Failed to fetch auctions:', err.message);
    return [];
  }
}

async function fetchAllAuctionUUIDs() {
  try {
    const auctions = await fetchAllAuctions();
    return auctions.map(a => a.id);
  } catch (err) {
    console.error('getAuctions.js fetchAllAuctionUUIDs: Failed to fetch auction UUIDs:', err.message);
    return [];
  }
}

async function fetchAuctionWinners(auctionId) {
  try {
    console.log("fetchAuctionWinners...");
    const response  = await bidjsClient.get(`${BIDJS_BASE}/auction-mgt/bdxapi/reporting/auction/${auctionId}/category?clientId=${Client_ID}`);
    const data      = response.data;
    
    // The report model lives under data.models.auctionReport
    const report = data.models && data.models.auctionReport;
    const items  = report && report.items;
    console.log("fetchAuctionWinners items:", items);

    if (!Array.isArray(items)) {
      console.warn(`No report items for auction ${auctionId}`);
      return [];
    }

    // Keep only those items that have a winner
    const winners = items
      .filter(item => item.winner)
      .map(item => {
        return {
          itemId:    item.id,
          lotNumber: item.lotNumber,
          winner:    item.winner
        };
      });
    console.log("winners winners:", winners);  
    return winners;
  } catch (err) {
    console.error(
      `Failed to fetch winners for auction ${auctionId}:`,
      err.message
    );
    return [];
  }
}

module.exports = {
  fetchAllAuctions,
  fetchActiveAuctions,
  fetchAllAuctionUUIDs,
  getAuctionReport,
  fetchAuctionWinners
};
