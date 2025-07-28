// bidjsClient.js
const axios = require('axios');
const { getBidJsSignature } = require('./auth');
const { API_KEY, BIDJS_BASE } = require('./config');

const bidjsClient = axios.create({ baseURL: BIDJS_BASE });
//bidjsClient.defaults.headers.common['Authorization']    = `Bearer ${API_KEY}`;
bidjsClient.defaults.headers.common['BDXAPI_NAME']      = getBidJsSignature();


module.exports = bidjsClient;
