// src/registrants.js
const { BIDJS_BASE, Client_ID } = require('./config');
const bidjsClient = require('./bidjsClient');

async function fetchAllRegistrants(auctionId) {
  try {
    // 1) Make the GET /auctions/{auctionId}/registrants call
    const response = await bidjsClient.get(`/auctions/${auctionId}/registrants`);
    const data = response.data;

    console.log('fetchAllRegistrants response.data:', response.data);

    // 2) Drill into the returned payload.
    // According to the DataPushPayload format, registrants will
    // be under data.models.registrantReferenceModel.collection
    const registrants =
      data.models?.registrantReferenceModel?.collection || data.registrants ||  [];
        console.log('fetchAllRegistrants: registrants:', registrants);
    return registrants;
  } catch (err) {
    console.error(
      `fetchAllRegistrants: Failed to fetch registrants for auction ${auctionId}:`,
      err.message
    );
    return [];
  }
}

module.exports = { fetchAllRegistrants };
