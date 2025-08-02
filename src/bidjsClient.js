// bidjsClient.js
const axios = require('axios');
const { getBidJsSignature } = require('./auth');
const { BIDJS_BASE,  BIDJS_BASE_II} = require('./config');

const bidjsClient = axios.create({ baseURL: BIDJS_BASE });
bidjsClient.defaults.headers.common['BDXAPI_NAME']      = getBidJsSignature();

const bidjsMgmtClient = axios.create({ baseURL: BIDJS_BASE_II });
bidjsMgmtClient.defaults.headers.common['BDXAPI_NAME'] = getBidJsSignature();

module.exports = { bidjsClient, createBidJsClient };