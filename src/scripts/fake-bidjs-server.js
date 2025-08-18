// scripts/fake-bidjs-server.js
const WebSocket = require('ws');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port }, () => {
  console.log(`Fake BidJS WebSocket server listening on ws://localhost:${port}`);
});

wss.on('connection', (ws, req) => {
  console.log('Client connected from', req.socket.remoteAddress);

  // Send a BID_PLACED after 1 second (gives your client time to subscribe)
  setTimeout(() => {
    const msg = {
      action: 'BID_PLACED',
      data: {
        auctionUuid: '8c9a8bb8-24ee-432c-b81e-ab514e69ce1d',
        bid: {
          uuid: 'bid-0001',
          userUuid: 'ecb4dab8-feee-425d-98a0-df7ede1ac7b8',
          listingUuid: 'listing-101'
        },
        saleStatus: {
          highestBidUuid: 'bid-0001',
          listingUuid: 'listing-101'
        }
      }
    };
    ws.send(JSON.stringify(msg));
    console.log('Sent BID_PLACED to client');
  }, 1000);

  ws.on('message', (m) => {
    console.log('Message from client:', String(m).slice(0,200));
  });

  ws.on('close', () => console.log('Client disconnected'));
});
