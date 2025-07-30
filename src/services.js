// src/services.js
const db = require('./db');
const bidjsClient = require('./bidjsClient');

async function enforceLimitsForAuction(auctionId) {
  console.log(`\n🛎️ Enforcing limits for auction: ${auctionId}`);

  // 1) Fetch the Auction Report
  console.log(`📡 Fetching auction report for ${auctionId}...`);
  const resp = await bidjsClient.get(
    `/auction-mgt/bdxapi/reporting/auction/${auctionId}/category?clientId=411`
  );
  const report = resp.data?.models?.auctionReport || {};
  const items = report.items || [];
  const auctionUuid = report.auctionUuid || null;
  console.log(`✅ Retrieved ${items.length} items; auctionUuid=${auctionUuid}`);

  // 2) Build totals & collect all seen registrants, plus metadata
  const totals = {};      // userId -> wins count
  const seen = {};        // userId -> true
  const meta = {};        // userId -> { fullname, email }

  console.log(`\n📊 Processing items...`);
  for (const item of items) {
    const w = item.winner;
    if (w?.userId) {
      seen[w.userId] = true;
      totals[w.userId] = (totals[w.userId] || 0) + 1;
      meta[w.userId] = { fullname: w.fullname, email: w.email };
      console.log(`🏅 Lot ${item.lotNumber} won by userId ${w.userId}`);
    }
    if (Array.isArray(item.losers)) {
      for (const l of item.losers) {
        if (l.userId) {
          seen[l.userId] = true;
          // capture loser metadata if present
          if (!meta[l.userId]) {
            meta[l.userId] = { fullname: l.fullname, email: l.email };
          }
        }
      }
    }
  }
  console.log(`\n📁 Winning totals:`, totals);
  console.log(`👥 Total registrants seen: ${Object.keys(seen).length}`);

  // 3) Seed DB: upsert every seen userId with its currentTotal and metadata
  console.log(`\n💾 Seeding DB with registrants & their win counts...`);
  const now = new Date().toISOString();

  // Fetch existing records once
  const existingRows = await db.getAllForAuction(auctionId);
  const existingByUser = existingRows.reduce((acc, row) => {
    acc[row.userId] = row;
    return acc;
  }, {});

  for (const userId of Object.keys(seen)) {
    const existing = existingByUser[userId] || {};
    const userMeta = meta[userId] || {};

    await db.upsert({
      auctionId,
      auctionUuid,
      userId,
      fullname: userMeta.fullname ?? existing.fullname ?? null,
      email:    userMeta.email    ?? existing.email    ?? null,
      bidLimit: existing.bidLimit ?? null,
      currentTotal: totals[userId] || 0,
      paused: existing.paused ?? false,
      updatedAt: now,
    });

    console.log(
      `   🔄 Upserted userId=${userId} (wins=${totals[userId] || 0}, ` +
      `fullname="${userMeta.fullname || existing.fullname || ''}", ` +
      `email="${userMeta.email || existing.email || ''}")`
    );
  }

  // 4) Fetch all registrants now in DB
  console.log(`\n🗃️ Fetching registrants from DB for auction ${auctionId}...`);
  const regs = await db.getAllForAuction(auctionId);
  console.log(`✅ Found ${regs.length} registrants in DB.`);

  // 5) Enforce limits via BidJS API
  for (const reg of regs) {
    const total     = reg.currentTotal;
    const bidLimit  = reg.bidLimit;
    const overLimit = bidLimit !== null && total >= bidLimit;

    console.log(`\n👤 Checking userId ${reg.userId}`);
    console.log(`   - Full name:   ${reg.fullname || '(unknown)'}`);
    console.log(`   - Email:       ${reg.email || '(unknown)'}`);
    console.log(`   - Auction UUID:${reg.auctionUuid || '(none)'}`);
    console.log(`   - Bid limit:   ${bidLimit === null ? 'Unlimited' : bidLimit}`);
    console.log(`   - CurrentTotal:${total}`);
    console.log(`   - Previously paused: ${!!reg.paused}`);
    console.log(`   - Over limit? ${overLimit}`);

    if (overLimit !== !!reg.paused) {
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
