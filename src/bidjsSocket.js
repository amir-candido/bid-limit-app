// src/bidjsSocket.js
const WebSocket = require('ws');
const { BIDJS_WS_URL, Client_ID } = require('./config');
const { getBidJsSignature } = require('./auth');
const { enforceLimitsForAuction } = require('./services');
const { fetchAllAuctionUUIDs } = require('./getAuctions');

function startBidJsSocket() {
  console.log('📡 Connecting to BidJS WebSocket...');

  const ws = new WebSocket(BIDJS_WS_URL, {
    headers: {
      'bdxapi_name': getBidJsSignature(),
      'CLIENT_ID': Client_ID
    }
  });

  // FIX 1: Make open handler async
  ws.on('open', async () => {
    console.log('✅ Connected to BidJS WebSocket');

    try {
      // FIX 2: Simplify array handling
      const auctionUUIDs = await fetchAllAuctionUUIDs();
      
      // FIX 3: Add connection check before sending
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          action: 'SubscribeToAuction', 
          data: auctionUUIDs 
        }));
      } else {
        console.warn('⚠️ WebSocket closed before subscription could complete');
      }
    } catch (err) {
      console.error('❌ Failed to fetch auctions:', err);
      ws.close(); // Graceful shutdown on error
    }
  });

  ws.on('message', async (message) => {
    try {
      const { action, data } = JSON.parse(message);
      console.log('📨 Received event:', action);

      if (action === 'SALE_COMPLETED') {
        const auctionId = data.sale.auctionId;
        console.log(`🏆 Lot won — re-enforcing limits for auction ${auctionId}`);
        await enforceLimitsForAuction(auctionId);
      }
    } catch (err) {
      console.error('❌ Error processing WebSocket message:', err);
    }
  });

  // FIX 4: Prevent multiple reconnection timers
  let reconnectTimer;
  const scheduleReconnect = () => {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBidJsSocket();
      }, 5000);
    }
  };

  ws.on('close', () => {
    console.warn('⚠️ WebSocket connection closed. Reconnecting in 5s...');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err);
    // Close will trigger reconnect automatically
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
  });
}

module.exports = { startBidJsSocket };