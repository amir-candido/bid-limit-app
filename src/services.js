const db = require('./db');
const bidjsClient = require('./bidjsClient');

async function enforceLimitsForAuction(auctionUuid) {
  console.log(`\n🛎️ Enforcing limits for auction: ${auctionUuid}`);

  // 1) Fetch the Auction Report
  console.log(`📡 Fetching auction report for ${auctionUuid}...`);
  const resp = await bidjsClient.get(`/auction-mgt/bdxapi/reporting/auction/${auctionUuid}/category?clientId=411`);
  const items = resp.data?.models?.auctionReport?.items || [];

  console.log(`✅ Retrieved ${items.length} items from auction report`);

  // 2) Sum winning bids per userId
  const totals = {}; // key: userId, value: number of lots won
  console.log(`\n📊 Processing winning items...`);
  for (const item of items) {
    const winner = item.winner;
    if (winner && winner.userId) {
      const userId = winner.userId;
      totals[userId] = (totals[userId] || 0) + 1;
      console.log(`🏅 Lot ${item.lotNumber} won by userId ${userId} — total wins so far: ${totals[userId]}`);
    } 
  }

  console.log(`\n📁 Winning totals:`, totals);

  // 3) Fetch all registrants from DB for this auction
  console.log(`\n🗃️ Fetching registered bidders from DB for auction ${auctionUuid}...`);
  const regs = await db.getAllForAuction(auctionUuid);
  console.log(`✅ Found ${regs.length} registrants in DB.`);

  // 4) Evaluate and enforce limits
  for (let reg of regs) {
    const currentTotal = totals[reg.userId] || 0;
    const overLimit = reg.bidLimit !== null && currentTotal >= reg.bidLimit;

    console.log(`\n👤 Checking userId ${reg.userId}`);
    console.log(`   - Bid limit: ${reg.bidLimit === null ? 'Unlimited' : reg.bidLimit}`);
    console.log(`   - Current wins: ${currentTotal}`);
    console.log(`   - Previously paused: ${!!reg.paused}`);
    console.log(`   - Over limit? ${overLimit ? 'YES' : 'NO'}`);

    // Update DB
    await db.upsert({
      auctionUuid,
      userId: reg.userId,
      bidLimit: reg.bidLimit,
      currentTotal,
      paused: overLimit,
      updatedAt: new Date().toISOString(),
    });
    console.log(`   📥 Updated DB record for userId ${reg.userId}`);

    // 5) Call BidJS API if status needs to change
    if (overLimit && !reg.paused) {
      console.log(`   🚫 Pausing userId ${reg.userId} via BidJS API...`);
      await bidjsClient.patch(`/v2/auctions/${auctionUuid}/registrants/${reg.userId}`, {
        status: 'DepositRequested',
      });
      console.log(`   ✅ Paused userId ${reg.userId}`);
    } else if (!overLimit && reg.paused) {
      console.log(`   🔓 Unpausing userId ${reg.userId} via BidJS API...`);
      await bidjsClient.patch(`/v2/auctions/${auctionUuid}/registrants/${reg.userId}`, {
        status: 'Approved',
      });
      console.log(`   ✅ Unpaused userId ${reg.userId}`);
    } else {
      console.log(`   ⏸️ No status change needed for userId ${reg.userId}`);
    }
  }

  console.log(`\n✅ Enforcement complete for auction ${auctionUuid}\n`);
}

module.exports = { enforceLimitsForAuction };
