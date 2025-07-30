// src/service.js
const db = require('./db');
const bidjsClient = require('./bidjsClient');

async function enforceLimitsForAuction(auctionId) {
  console.log(`\n🛎️ Enforcing limits for auction: ${auctionId}`);

  // 1) Fetch the Auction Report
  console.log(`📡 Fetching auction report for ${auctionId}...`);
  const resp = await bidjsClient.get(
    `/auction-mgt/bdxapi/reporting/auction/${auctionId}/category?clientId=411`
  );
  const items = resp.data?.models?.auctionReport?.items || [];
  console.log(`✅ Retrieved ${items.length} items from auction report`);

  // 2) Build totals & collect all seen registrants
  const totals = {};        // userId -> wins count
  const seen = {};          // userId -> true
  console.log(`\n📊 Processing items...`);
  for (const item of items) {
    // Winner
    const w = item.winner;
    if (w && w.userId) {
      seen[w.userId] = true;
      totals[w.userId] = (totals[w.userId] || 0) + 1;
      console.log(`🏅 Lot ${item.lotNumber} won by userId ${w.userId}`);
    }
    // Losers (to seed them in DB with zero wins)
    if (Array.isArray(item.losers)) {
      for (const l of item.losers) {
        if (l.userId) {
          seen[l.userId] = true;
        }
      }
    }
  }
  console.log(`\n📁 Winning totals:`, totals);
  console.log(`👥 Total registrants seen: ${Object.keys(seen).length}`);

  // 3) Seed DB: upsert every seen userId with its currentTotal
  console.log(`\n💾 Seeding DB with registrants & their win counts...`);
  const now = new Date().toISOString();
  for (const userId of Object.keys(seen)) {
    // fetch existing record to preserve bidLimit & paused flag
    const [existing] = await db.getAllForAuction(auctionId)
      .then(rows => rows.filter(r => r.userId === userId));

    await db.upsert({
      auctionId,
      userId,
      bidLimit: existing ? existing.bidLimit : null,
      currentTotal: totals[userId] || 0,
      paused: existing ? existing.paused : false,
      updatedAt: now,
    });
    console.log(`   🔄 Upserted userId ${userId} (wins=${totals[userId] || 0})`);
  }

  // 4) Fetch all registrants now in DB
  console.log(`\n🗃️ Fetching registrants from DB for auction ${auctionId}...`);
  const regs = await db.getAllForAuction(auctionId);
  console.log(`✅ Found ${regs.length} registrants in DB.`);

  // 5) Enforce limits via BidJS API
  for (const reg of regs) {
    const total = reg.currentTotal;
    const overLimit = reg.bidLimit !== null && total >= reg.bidLimit;

    console.log(`\n👤 Checking userId ${reg.userId}`);
    console.log(`   - Bid limit: ${reg.bidLimit === null ? 'Unlimited' : reg.bidLimit}`);
    console.log(`   - CurrentTotal: ${total}`);
    console.log(`   - Previously paused: ${!!reg.paused}`);
    console.log(`   - Over limit? ${overLimit}`);

    // Update paused flag if changed
    if (overLimit !== !!reg.paused) {
      // call BidJS to change status
      const newStatus = overLimit ? 'DepositRequested' : 'Approved';
      console.log(`   🔄 Setting status=${newStatus} on BidJS for userId ${reg.userId}`);
      await bidjsClient.patch(
        `/v2/auctions/${auctionId}/registrants/${reg.userId}`,
        { status: newStatus }
      );
      console.log(`   ✅ BidJS status updated to ${newStatus}`);
    } else {
      console.log(`   ⏸️ No status change needed`);
    }
  }

  console.log(`\n✅ Enforcement complete for auction ${auctionId}\n`);
}

module.exports = { enforceLimitsForAuction };
