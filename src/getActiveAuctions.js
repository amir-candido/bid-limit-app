
const { BIDJS_BASE, API_KEY } = require('./config');
const bidjsClient = require('./bidjsClient');

async function fetchActiveAuctions() {
  try {
    const response = await bidjsClient.get(`${BIDJS_BASE}/api/auctions`);

    // Filter for active auctions if needed
    const activeAuctions = response.data.auctions?.filter(a => a.status === 'active') || [];

    // Return only the IDs
    return activeAuctions.map(a => a.id);
  } catch (err) {
    console.error('❌ Failed to fetch active auctions:', err.message);
    return [];
  }
}

module.exports = fetchActiveAuctions;
