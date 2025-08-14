const { processNewHighestBid } = require('./processNewHighestBid');

// handleMessage(msg) — core logic skeleton
async function handleMessage(msg) {
  if (!msg || !msg.action) return;
  const action = msg.action;
  const data = msg.data || {};

  if (action === 'AUCTION_SUBSCRIBED') {
    console.log('subscribed to auction', data);
    return;
  }

  if (action !== 'BID_PLACED') return; // ignore other events

  // message shape per docs: { auctionUuid, bid, saleStatus }
  const { auctionUuid, bid, saleStatus } = data;
  if (!auctionUuid || !bid || !saleStatus) {
    console.warn('BID_PLACED missing fields', data);
    return;
  }

  const bidUuid     = bid && bid.uuid;
  const userUuid    = bid && bid.userUuid;
  const listingUuid = saleStatus && (saleStatus.listingUuid || bid.listingUuid);

  if (!bidUuid || !userUuid || !listingUuid) {
    console.warn('BID_PLACED missing bid/listing/user identifiers', { auctionUuid, bidUuid, userUuid, listingUuid });
    return;
  }

  // If this bid is the new highest: saleStatus.highestBidUuid === bid.uuid
  const isNowHighest = (saleStatus.highestBidUuid === bidUuid);

  if (!isNowHighest) return;

  try {
    console.log('Processing new highest bid', { auctionUuid, listingUuid, bidUuid, userUuid });
    await processNewHighestBid({ auctionUuid, listingUuid, newUserUuid: userUuid, bidUuid });
  } catch (err) {
    // Local error handling — upstream ws code also catches, but this gives more context
    console.error('Error processing new highest bid', { auctionUuid, listingUuid, bidUuid, userUuid, err: err && err.message || err });
    // Optionally enqueue the event for retry:
    // await enqueuePendingBid({ auctionUuid, listingUuid, newUserUuid: userUuid, bidUuid });
  }
}

module.exports = { handleMessage };
