// src/test.js
const axios = require('axios');
const { BIDJS_BASE, API_KEY } = require('./config');

async function testConnection() {
  try {
    const response = await axios.get(`${BIDJS_BASE}/auctions`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    console.log('✅ Connected! Received data:', response.data);
  } catch (error) {
    console.error('❌ Error connecting to BidJS API:', error.message);
    console.error(error.response?.data || error);
  }
}

testConnection();
