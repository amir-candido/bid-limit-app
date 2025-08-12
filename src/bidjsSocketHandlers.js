// handleMessage(msg) — core logic skeleton
async function handleMessage(msg) {
  if (!msg || !msg.action) {return;}
  const action = msg.action;
  const data = msg.data || {};

  if (action === 'AUCTION_SUBSCRIBED') {
    console.log('subscribed to auction', data);
    return;
  }

  if (action !== 'BID_PLACED') return; // ignore other events

  // message shape per docs: { auctionUuid, bid, sale, saleStatus }
  const { auctionUuid, bid, sale, saleStatus } = data;
  if (!auctionUuid || !bid || !saleStatus) {
    console.warn('BID_PLACED missing fields', data);
    return;
  }

  // Models: bid.uuid, bid.userUuid, bid.listingUuid ; saleStatus.highestBidUuid, saleStatus.listingUuid.
  // If this bid is the new highest, saleStatus.highestBidUuid === bid.uuid
  const isNowHighest = (saleStatus.highestBidUuid === bid.uuid);

  if (isNowHighest) {
    // hand off to atomic redis handler to swap ownership, check limit, etc.
    await processNewHighestBid({ auctionUuid, listingUuid: saleStatus.listingUuid || bid.listingUuid, newUserUuid: bid.userUuid, bidUuid: bid.uuid });
  } else {
    // not the highest (maybe a lower / historic / cancelled bid) — could be ignored or used to update state
  }
}

module.exports = { handleMessage };