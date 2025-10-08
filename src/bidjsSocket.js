// src/bidjsSocket.js
const WebSocket                   = require('ws');
const { BIDJS_WS_URL, Client_ID } = require('./config');
const { getBidJsSignature }       = require('./auth');
const { fetchAllAuctionUUIDs }    = require('./bidjs-rest'); // REST helper

// Message handler - ensure this module exports a function that accepts the parsed msg
// and any needed dependencies (or imports them internally).
const { handleMessage }           = require('./handleMessage');

// Reconnect/backoff defaults
const RECONNECT_INITIAL = 1000; // 1s
const RECONNECT_MAX     = 30000;    // 30s
const KEEPALIVE_MS      = 9 * 60 * 1000; // 9 minutes - send Ping before 10 min server idle limit

/**
 * startBidJsSocket(options)
 *
 * options (optional): { auctionsToSubscribe: [uuid,...], onOpenCallback: fn, dependencies: {...} }
 *
 * - If auctionsToSubscribe omitted, it will call fetchAllAuctionUUIDs()
 * - The function tries to be robust: ping keepalive, exponential backoff reconnect,
 *   subscription acknowledgement handling, defensive parsing of incoming messages.
 */
function startBidJsSocket(options = {}) {

        const { auctionsToSubscribe } = options;
        let reconnectDelay = RECONNECT_INITIAL;
        let keepaliveTimer = null;
        let ws = null;

        async function connect() {
          console.log(`📡 Connecting to BidJS WebSocket at ${BIDJS_WS_URL}...`);

          ws = new WebSocket(BIDJS_WS_URL, {
            headers: {
              'bdxapi_name': getBidJsSignature(),
              'CLIENT_ID': Client_ID
            }
          });

          ws.on('open', async () => {
            console.log('✅ Connected to BidJS WebSocket');

            // reset reconnect backoff
            reconnectDelay = RECONNECT_INITIAL;

            // start keepalive ping timer
            if (keepaliveTimer) clearInterval(keepaliveTimer);
            keepaliveTimer = setInterval(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(JSON.stringify({ action: 'Ping' }));
                } catch (err) {
                  console.warn('Ping failed:', err);
                }
              }
            }, KEEPALIVE_MS);

            // Determine auctions to subscribe to
            let auctionUUIDs = auctionsToSubscribe;
            if (!Array.isArray(auctionUUIDs) || auctionUUIDs.length === 0) {
              try {
                auctionUUIDs = await fetchAllAuctionUUIDs();
              } catch (err) {
                console.error('❌ Failed to fetch auction UUIDs for subscription:', err);
                // Close socket and trigger reconnect logic
                try { ws.close(); } catch (e) {}
                return;
              }
            }

            if (!Array.isArray(auctionUUIDs) || auctionUUIDs.length === 0) {
              console.warn('No auctions to subscribe to (empty list).');
            } else {
              console.log(`Subscribing to ${auctionUUIDs.length} auction(s).`);

              // If the server has limits on subscription size, chunk here. For now send entire array.
              if (ws.readyState === WebSocket.OPEN) {
                const subMsg = JSON.stringify({ action: 'SubscribeToAuction', data: auctionUUIDs });
                ws.send(subMsg);
              } else {
                console.warn('WebSocket closed before subscription could complete');
              }
            }
          });

          // FIXED: use ws (not socket)
          ws.on('message', async (raw) => {
            try {
              // Some servers send non-JSON frames (pongs, binary), so guard parse
              const text = typeof raw === 'string' ? raw : raw.toString('utf8');
              const msg = JSON.parse(text);
              // hand off to your message business logic
              // handleMessage should return quickly; keep heavy work async (or it can call background jobs)
              try {
                await handleMessage(msg);
              } catch (err) {
                console.error('Error in handleMessage:', err);
                // Optionally enqueue msg for retry processing
              }
            } catch (err) {
              console.warn('Invalid WS message (non-JSON or parse error):', err);
            }
          });

          ws.on('close', (code, reason) => {
            console.warn(`⚠️ WebSocket connection closed (code=${code}) - will reconnect in ${reconnectDelay} ms. Reason:`, reason && reason.toString ? reason.toString() : reason);
            // cleanup keepalive
            if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
            scheduleReconnect();
          });

          ws.on('error', (err) => {
            console.error('❌ WebSocket error:', err);
            // Ensure socket is closed so close handler schedules reconnect
            try {
              if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
            } catch (e) {}
          });
        } // connect()

        function scheduleReconnect() {
          // exponential backoff up to RECONNECT_MAX
          const delay = reconnectDelay;
          reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
          console.log(`Scheduling reconnect in ${delay} ms`);
          setTimeout(() => {
            connect().catch(err => {
              console.error('Reconnect attempt failed:', err);
              scheduleReconnect();
            });
          }, delay);
        }

        // Start first connection
        let isConnecting = false;
        async function connect() {
          if (isConnecting) return;
          isConnecting = true;
          try {
            scheduleReconnect();
          } finally {
            isConnecting = false;
          }
        }
}

module.exports = { startBidJsSocket };
