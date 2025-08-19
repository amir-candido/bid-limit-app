
const { BIDJS_BASE, Client_ID, Auctioneer_ID, BIDJS_BASE_II } = require('./config');
const { bidjsClient } = require('./bidjsClient');


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

    console.log("Running fetchAllAuctions...");

    const url = `${BIDJS_BASE}/auction-mgt/bdxapi/auctions/${Auctioneer_ID}?clientId=${Client_ID}`;

    console.log("url:", url);

    const { data } = await bidjsClient.get( `${BIDJS_BASE}/auction-mgt/bdxapi/auctions/${Auctioneer_ID}?clientId=${Client_ID}` );
    return data.models?.auctionReferenceModel?.collection || [];
  } catch (err) {
    console.error('fetchAllAuctions: Failed to fetch auctions:', err.message);
    return [];
  }
}

async function fetchAllAuctionUUIDs() {

  try {
  const { data } = await bidjsClient.get(`${BIDJS_BASE}/auction-mgt/bdxapi/auctions/${Auctioneer_ID}?clientId=${Client_ID}`);
  const auctions = data.models?.auctionReferenceModel?.collection || [];
  return auctions.map(a => a.uuid);
  } catch (err) {
  console.error('bidjs-rest.js fetchAllAuctionUUIDs: Failed to fetch auction UUIDs:', err.message);
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

async function fetchAllRegistrantsByAuctionId(auctionId) {
  try {
    const res           = await bidjsClient.get(`${BIDJS_BASE_II}/auctions/${auctionId}/registrants`);
    const registrants   = res.data.message;

    return registrants.map(r => ({
            registrantUuid: r.registrantUuid,
            userId: r.userId,
            username: r.username,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            status: r.registrationStatusName
        }));

  } catch (err) {
    console.error(`❌ Failed to fetch registrants for auction ${auctionId}:`, err.message);
    return [];
  }
}

/**
 * Suspends or updates a registrant's status in BidJS.
 * @param {string} auctionUuid - The UUID of the auction.
 * @param {string} registrantUuid - The UUID of the registrant.
 * @param {string} status - The status to set (default: 'SUSPENDED').
 * @returns {Promise<Object>} - The API response data.
 */
async function patchRegistrant(auctionUuid, registrantUuid, status = 'AWAITING_DEPOSIT') {
  console.log('--- patchRegistrant called ---');
  console.log('Auction UUID:', auctionUuid);
  console.log('Registrant UUID:', registrantUuid);
  console.log('New Status:', status);

  try {
    const endpoint = `${BIDJS_BASE}/v2/auctions/${auctionUuid}/registrants/${registrantUuid}`;
    console.log('PATCH Endpoint:', endpoint);

    const payload = { "statusChange": status };
    console.log('Request Payload:', payload);

    const { data } = await bidjsClient.patch(endpoint, payload);
    console.log('BidJS Response:', JSON.stringify(data, null, 2));

    console.log('--- patchRegistrant completed successfully ---');
    return data;

  } catch (error) {
    console.error('--- patchRegistrant ERROR ---');
    console.error('Error Message:', error.message);
    if (error.response) {
      console.error('Status Code:', error.response.status);
      console.error('Error Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('------------------------------');
    throw error;
  }
}


module.exports = {
  fetchAllAuctions,
  fetchActiveAuctions,
  fetchAllAuctionUUIDs,
  getAuctionReport,
  fetchAuctionWinners,
  fetchAllRegistrantsByAuctionId,
  patchRegistrant
};
