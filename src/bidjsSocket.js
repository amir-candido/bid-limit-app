// src/bidjsSocket.js
const WebSocket = require('ws');
const { BIDJS_WS_URL, Client_ID } = require('./config');
const { getBidJsSignature } = require('./auth');
const { fetchAllAuctionUUIDs } = require('./bidjs-rest'); // REST helper

const { handleMessage } = require('./bidjsSocketHandlers');

// Constant for WebSocket reconnection delay
const RECONNECT_DELAY = 5000; // 5 seconds

/**
 * Establishes a WebSocket connection to BidJS and sets up event handlers for auction events.
 */
function startBidJsSocket() {
  console.log(`📡 Connecting to BidJS WebSocket at ${BIDJS_WS_URL}...`);

  const ws = new WebSocket(BIDJS_WS_URL, {
    headers: {
      'bdxapi_name': getBidJsSignature(),
      'CLIENT_ID': Client_ID
    }
  });

  // Handle WebSocket connection opening
  ws.on('open', async () => {
    console.log('✅ Connected to BidJS WebSocket');

    try {
      // Fetch all auction UUIDs to subscribe to
      const auctionUUIDs = await fetchAllAuctionUUIDs();
      console.log('auctionUUIDs:', auctionUUIDs);

      // Subscribe to auctions if the WebSocket is still open
      //To subscribe to multiple Auctions you must send a message with an Array of Auction UUIDs, as follows.
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
      ws.close();
    }
  });

  // Handle incoming WebSocket messages
   socket.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(msg);
    } catch (err) {
      console.warn('Invalid WS message', err);
    }
  });

  // Handle WebSocket reconnection logic
  let reconnectTimer;
  /**
   * Schedules a reconnection attempt after a delay to avoid overwhelming the server.
   */
  const scheduleReconnect = () => {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBidJsSocket();
      }, RECONNECT_DELAY);
    }
  };

  // Handle WebSocket connection closure
  ws.on('close', () => {
    console.warn('⚠️ WebSocket connection closed. Reconnecting in 5s...');
    scheduleReconnect();
  });

  // Handle WebSocket errors
  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err);
    if (ws.readyState !== WebSocket.CLOSED) {
      // Close the WebSocket to trigger reconnection
      ws.close();
    }
  });
}

module.exports = { startBidJsSocket };