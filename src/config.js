require('dotenv').config();

module.exports = {
  BIDJS_BASE: process.env.BIDJS_BASE_URL,
  API_KEY: process.env.BIDJS_API_KEY,
  // ACTIVE_AUCTIONS: process.env.ACTIVE_AUCTIONS.split(','),  // e.g. "uuid1,uuid2"
  PORT: process.env.PORT || 3000,
  API_SECRET: process.env.API_SECRET,
  Client_ID: process.env.Client_ID,
  Auctioneer_ID: process.env.Auctioneer_ID,
};
