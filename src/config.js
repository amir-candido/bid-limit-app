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
  BIDJS_BASE_II: process.env.BIDJS_BASE_II,
  BIDJS_WS_URL: process.env.BIDJS_WS_URL,
  SVIX_WEBHOOK_SECRET: process.env.SVIX_WEBHOOK_SECRET,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_USER: process.env.DB_USER,
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT

};
