// bidjsClient.js
const axios = require('axios');
const { getBidJsSignature } = require('./auth');
const { BIDJS_BASE,  BIDJS_BASE_II} = require('./config');

const bidjsClient = axios.create({ baseURL: BIDJS_BASE });
bidjsClient.defaults.headers.common['bdxapi_name']      = getBidJsSignature();

const bidjsMgmtClient = axios.create({ baseURL: BIDJS_BASE_II });
bidjsMgmtClient.defaults.headers.common['bdxapi_name'] = getBidJsSignature();

module.exports = { bidjsClient, bidjsMgmtClient };