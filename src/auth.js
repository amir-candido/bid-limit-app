// auth.js
const crypto = require('crypto');
const { API_KEY, Client_ID, API_SECRET } = require('./config');

function getBidJsSignature() {
  const stringToSign = `bdxapikey=${API_KEY}&bdxapiClientId=${Client_ID}&bdxapisecret=${API_SECRET}`;

  return crypto
    .createHash('sha1')
    .update(stringToSign, 'utf8')
    .digest('hex');
}

module.exports = { getBidJsSignature };
