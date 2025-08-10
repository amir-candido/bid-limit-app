// src/handlers.js
const {
  getRegistrant, setRegistrant,
  getCurrentHighest, upsertCurrentHighest,
  countActiveLots
} = require('./db');
const { patchRegistrant } = require('./bidjs-rest');

async function handleBidPlaced({ auctionUuid, bid }) {
  const lotId     = bid.listingUuid;
  const bidId     = bid.uuid;
  const bidderId  = bid.userUuid;

  // 1. Who was leading?
  const oldLead = await getCurrentHighest(auctionUuid, lotId);

  // 2. Record new leader
  await upsertCurrentHighest(auctionUuid, lotId, bidId, bidderId);

  // 3. Re-qualify old leader if needed
  if (oldLead && oldLead.userUuid !== bidderId) {
    const prevId = oldLead.userUuid;
    const count  = await countActiveLots(auctionUuid, prevId);
    const reg    = await getRegistrant(auctionUuid, prevId);

    if (reg.bidLimit !== null && count < reg.bidLimit && reg.status !== 'QUALIFIED') {
      await patchRegistrant(auctionUuid, prevId, { status: 'QUALIFIED' });
      await setRegistrant(auctionUuid, prevId, { limit: reg.bidLimit, status: 'QUALIFIED' });
    }
  }

  // 4. Enforce new bidder’s limit
  const newCount = await countActiveLots(auctionUuid, bidderId);
  const newReg   = await getRegistrant(auctionUuid, bidderId);
  if (newReg.bidLimit !== null && newCount > newReg.bidLimit && newReg.status !== 'AWAITING_DEPOSIT') {
    await patchRegistrant(auctionUuid, bidderId, { status: 'AWAITING_DEPOSIT' });
    await setRegistrant(auctionUuid, bidderId, { limit: newReg.bidLimit, status: 'AWAITING_DEPOSIT' });
  }
}

async function handleBidCancelled(data) {
  // simply re-run placed logic on saleStatus to recalc slots
  await handleBidPlaced(data);
}
// you can export more handlers here...

module.exports = {
  handleBidPlaced,
  handleBidCancelled,
  // etc.
};
