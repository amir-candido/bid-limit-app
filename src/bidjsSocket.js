// src/bidjsSocket.js
const WebSocket = require('ws');
const { BIDJS_WS_URL, Client_ID } = require('./config');
const { getBidJsSignature } = require('./auth');
const { fetchAllAuctionUUIDs, fetchAllRegistrantsByAuctionId } = require('./bidjs-rest'); // REST helper
const { getRegistrant, setRegistrant, getCurrentHighest, upsertCurrentHighest, countActiveLots } = require('./db');

// Cache for registrant information to avoid repeated REST calls
// Structure: Map<auctionId, Map<registrantUuid, { name: string, email: string }>>
const registrantCache = new Map();

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

      // Subscribe to auctions if the WebSocket is still open
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          action: 'SubscribeToAuction',
          data: auctionUUIDs
        }));
      } else {
        console.warn('⚠️ WebSocket closed before subscription could complete');
      }

      // Cache registrant information for all auctions in parallel to optimize performance
      await Promise.all(auctionUUIDs.map(async auctionId => {
        // Skip fetching if registrant data is already cached
        if (registrantCache.has(auctionId)) {
          return;
        }
        try {
          const registrants = await fetchAllRegistrantsByAuctionId(auctionId);
          const userMap = new Map();
          for (const r of registrants) {
            userMap.set(r.registrantUuid, { name: `${r.firstName} ${r.lastName}`, email: r.email });
          }
          registrantCache.set(auctionId, userMap);
          console.log(`📦 Cached ${userMap.size} registrants for auction ${auctionId}`);
        } catch (err) {
          console.error(`❌ Failed to fetch registrants for auction ${auctionId}:`, err.message);
          // Continue processing other auctions even if this one fails
        }
      }));

      console.log(`📦 Cached registrant info for ${auctionUUIDs.length} auctions`);
    } catch (err) {
      console.error('❌ Failed to fetch auctions:', err);
      ws.close();
    }
  });

  // Handle incoming WebSocket messages
  ws.on('message', async (message) => {
    try {
      // Parse and validate the incoming message
      const parsed = JSON.parse(message);
      if (!parsed.action || !parsed.data) {
        console.error('❌ Invalid message format:', message);
        return;
      }
      const { action, data } = parsed;
      console.log(`📨 Received event: ${action}`);

      // Process BID_PLACED events to update bids and enforce bid limits
      if (action === 'BID_PLACED') {
        // Extract bid details
        const auctionId = data.auctionUuid;
        const bidInfo = data.bid;
        const lotId = bidInfo.listingUuid;
        const newBidId = bidInfo.uuid;
        const newBidder = bidInfo.userUuid;

        // Validate that all required bid data is present
        if (!auctionId || !bidInfo || !lotId || !newBidId || !newBidder) {
          console.error('❌ Incomplete bid data:', data);
          return;
        }

        // Step 1: Fetch the previous highest bidder for this lot
        const previousLeader = await getCurrentHighest(auctionId, lotId);

        // Step 2: Record the new highest bid in the database
        await upsertCurrentHighest(auctionId, lotId, newBidId, newBidder);

        // Step 3: Check if the previous leader can be re-qualified after being outbid
        if (previousLeader && previousLeader.userUuid !== newBidder) {
          const prevUser = previousLeader.userUuid;
          const prevCount = await countActiveLots(auctionId, prevUser);
          const prevRegistrant = await getRegistrant(auctionId, prevUser);

          // Re-qualify the previous bidder if they’re below their limit and not already approved
          if (
            prevRegistrant.bidLimit !== null &&
            prevCount < prevRegistrant.bidLimit &&
            prevRegistrant.status !== 'APPROVED'
          ) {
            console.log(`🔄 Re-qualifying registrant ${prevUser} for auction ${auctionId}`);
            // Update external system via REST API
            await patchRegistrant(auctionId, prevUser, { status: 'APPROVED' });
            // Sync local database with the new status
            await setRegistrant(auctionId, prevUser, { limit: prevRegistrant.bidLimit, status: 'APPROVED' });
          }
        }

        // Step 4: Enforce bid limit for the new bidder
        const newCount = await countActiveLots(auctionId, newBidder);
        const newRegistrant = await getRegistrant(auctionId, newBidder);

        // Block the new bidder if they’ve reached or exceeded their bid limit
        if (
          newRegistrant.bidLimit !== null &&
          newCount >= newRegistrant.bidLimit
        ) {
          if (newRegistrant.status !== 'AWAITING_DEPOSIT') {
            console.log(`🚫 Blocking registrant ${newBidder} for auction ${auctionId} due to bid limit`);
            // Update external system via REST API
            await patchRegistrant(auctionId, newBidder, { status: 'AWAITING_DEPOSIT' });
            // Sync local database with the new status
            await setRegistrant(auctionId, newBidder, { limit: newRegistrant.bidLimit, status: 'AWAITING_DEPOSIT' });
          }
        }
      }
    } catch (err) {
      console.error('❌ Critical error in message handler:', err);
      // 1) Close the socket (stop processing new events)
      ws.close();
      // 2) Optionally, kill process so it restarts cleanly
      process.exit(1);      
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

module.exports = { startBidJsSocket, registrantCache };