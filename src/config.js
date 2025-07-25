require('dotenv').config();

module.exports = {
  BIDJS_BASE: 'https://api.bidjs.com/v1',
  API_KEY: process.env.API_KEY,
  ACTIVE_AUCTIONS: process.env.ACTIVE_AUCTIONS.split(','),  // e.g. "uuid1,uuid2"
  PORT: process.env.PORT || 3000,
};
