require('dotenv').config({ debug: false, quiet: true });

module.exports = {
  BIDJS_BASE: process.env.BIDJS_BASE,
  API_KEY: process.env.API_KEY,
  PORT: process.env.PORT || 3001,
  API_SECRET: process.env.API_SECRET,
  Client_ID: process.env.Client_ID,
  Auctioneer_ID: process.env.Auctioneer_ID,
  CORS_ORIGIN_LOCAL: process.env.CORS_ORIGIN_LOCAL,
  CORS_ORIGIN_PRODUCTION: process.env.CORS_ORIGIN_PRODUCTION,
  BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
};
