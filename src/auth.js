// auth.js
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { API_KEY, Client_ID, API_SECRET, BCRYPT_SALT_ROUNDS } = require('./config');

function getBidJsSignature() {

  const stringToSign  = `bdxapikey=${API_KEY}&bdxapiClientId=${Client_ID}&bdxapisecret=${API_SECRET}`; 
  const signature     = crypto.createHash('sha1').update(stringToSign, 'utf8').digest('hex');
  return signature;

}

async function hashPassword(plaintext) {
  // bcrypt will generate its own salt internally when you pass in saltRounds
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const hash = await bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);
  return hash; // ~60-char string including salt & cost factor
}

async function verifyPassword(plaintext, storedHash) {
  const ok = await bcrypt.compare(plaintext, storedHash);
  return ok; // true if match, false otherwise
}


module.exports = {
  getBidJsSignature,
  hashPassword,
  verifyPassword,
};
