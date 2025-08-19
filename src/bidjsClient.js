// bidjsClient.js
const axios = require('axios');
const { getBidJsSignature } = require('./auth');
const { BIDJS_BASE,  BIDJS_BASE_II} = require('./config');

const signature = getBidJsSignature();
console.log("signature", signature);
const bidjsClient = axios.create({ baseURL: BIDJS_BASE });
bidjsClient.defaults.headers.common['bdxapi_name']      = signature;

const bidjsMgmtClient = axios.create({ baseURL: BIDJS_BASE_II });
bidjsMgmtClient.defaults.headers.common['bdxapi_name'] = signature;

module.exports = { bidjsClient, bidjsMgmtClient };