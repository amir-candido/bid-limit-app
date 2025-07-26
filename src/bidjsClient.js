// bidjsClient.js
const axios = require('axios');
const { getBidJsSignature } = require('./auth');
const { API_KEY, BIDJS_BASE } = require('./config');

const bidjsClient = axios.create({
  baseURL: BIDJS_BASE,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    BDXAPI_NAME: getBidJsSignature(),
  },
});

module.exports = bidjsClient;
