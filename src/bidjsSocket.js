// src/bidjsSocket.js
const WebSocket = require('ws');
const { BIDJS_WS_URL } = require('./config');
const { getBidJsSignature } = require('./auth');
const { enforceLimitsForAuction } = require('./services');

function startBidJsSocket() {
  console.log('📡 Connecting to BidJS WebSocket...');

  const ws = new WebSocket(BIDJS_WS_URL, {
    headers: {
      'bdxapi_name': getBidJsSignature()
    }
  });

  ws.on('open', () => {
    console.log('✅ Connected to BidJS WebSocket');
    // Optional: subscribe to a specific auction
    // ws.send(JSON.stringify({ action: 'subscribe', auctionId: 8095 }));
  });

  ws.on('message', async (message) => {
    try {
      const event = JSON.parse(message);
      console.log('📨 Received event:', event);

      // If a lot is won, re-check limits for that auction
      if (event.type === 'lot.won') {
        console.log(`🏆 Lot won — re-enforcing limits for auction ${event.auctionId}`);
        await enforceLimitsForAuction(event.auctionId);
      }
    } catch (err) {
      console.error('❌ Error processing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    console.warn('⚠️ WebSocket connection closed. Reconnecting in 5s...');
    setTimeout(startBidJsSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err);
  });
}

module.exports = { startBidJsSocket };
