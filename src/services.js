// src/services.js

// Import local modules:
//  - db: our wrapper around SQLite3 for CRUD operations on the `registrants` table
//  - bidjsClient: Axios instance preconfigured with BidJS API base URL and authentication headers
const db = require('./db');
const { bidjsClient, bidjsMgmtClient } = require('./bidjsClient');

/**
 * enforceLimitsForAuction
 * -----------------------
 * Main function to enforce per‐bidder win limits for a given auction.
 * 1) Fetch the auction report (items, winners, losers) from BidJS
 * 2) Build a list of all registrants seen in that report, count their wins,
 *    and collect metadata (fullname, email).
 * 3) Seed/upsert those registrants into our local DB, preserving existing limits.
 * 4) Read back all registrants from DB.
 * 5) For each registrant, compare currentTotal (wins) vs bidLimit, and
 *    call the BidJS Registrant API to pause/unpause as needed.
 *
 * @param {string} auctionId  – the ID of the auction to process
 */
async function enforceLimitsForAuction(auctionId) {
  console.log(`\n🛎️ Enforcing limits for auction: ${auctionId}`);

  // 1) Fetch the Auction Report
  // --------------------------------
  console.log(`📡 Fetching auction report for ${auctionId}...`);
  const resp = await bidjsClient.get(
    // BidJS endpoint for the per‐category auction report
    `/auction-mgt/bdxapi/reporting/auction/${auctionId}/category?clientId=411`
  );

  // The response payload follows the DataPushPayload format:
  // {
  //   "@class": ".DataPushPayload",
  //   "models": {
  //     "auctionReport": {
  //       "auctionUuid": "...",
  //       "items": [ { ItemReportModel }, ... ]
  //     }
  //   }
  // }
  const report = resp.data?.models?.auctionReport || {};
  const items = report.items || [];            // Array of ItemReportModel
  const auctionUuid = report.auctionUuid || null;

  // Check if auctionUuid is available
  if (!auctionUuid) {
    throw new Error(`No auctionUuid found in the auction report for auctionId ${auctionId}`);
  }

  console.log(`✅ Retrieved ${items.length} items; auctionUuid=${auctionUuid}`);

  // 2) Build totals & collect all seen registrants, plus metadata
  // --------------------------------------------------------------
  const totals = {};      // Maps userId -> number of lots they have won
  const seen = {};        // Maps userId -> true, for deduplication
  const meta = {};        // Maps userId -> { fullname, email }

  console.log(`\n📊 Processing items...`);
  for (const item of items) {
    // Each item has:
    //  - item.lotNumber
    //  - item.winner: RegistrantReportModel or null
    //  - item.losers: array of RegistrantReportModel or null
    const w = item.winner;
    if (w?.userId) {
      // Mark this user as seen
      seen[w.userId] = true;
      // Count one win for them
      totals[w.userId] = (totals[w.userId] || 0) + 1;
      // Capture metadata from the winner record
      meta[w.userId] = { fullname: w.fullname, email: w.email };
      console.log(`🏅 Lot ${item.lotNumber} won by userId ${w.userId}`);
    }

    // Also record any losers as registrants (even if they have zero wins)
    if (Array.isArray(item.losers)) {
      for (const l of item.losers) {
        if (l.userId) {
          seen[l.userId] = true;
          // If we don't already have metadata for this user, capture it
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
  // -------------------------------------------------------------------------
  console.log(`\n💾 Seeding DB with registrants & their win counts...`);
  const now = new Date().toISOString();

  // Fetch existing DB rows for this auction to preserve bid limits & paused flags
  const existingRows = await db.getAllForAuction(auctionId);
  // Build a map userId -> existing record
  const existingByUser = existingRows.reduce((acc, row) => {
    acc[row.userId] = row;
    return acc;
  }, {});

  // Upsert each seen registrant
  for (const userId of Object.keys(seen)) {
    const existing = existingByUser[userId] || {};
    const userMeta = meta[userId] || {};

    // upsert expects: auctionId, auctionUuid, userId, fullname, email, bidLimit, currentTotal, paused, updatedAt
    await db.upsert({
      auctionId,
      auctionUuid,
      userId,
      // Prefer newly fetched metadata, fallback to existing DB
      fullname:      userMeta.fullname    ?? existing.fullname    ?? null,
      email:         userMeta.email       ?? existing.email       ?? null,
      // Preserve any admin‐set limit
      bidLimit:      existing.bidLimit    ?? null,
      // Set the latest total wins
      currentTotal:  totals[userId]        || 0,
      // Preserve paused state until we re-evaluate below
      paused:        existing.paused       ?? false,
      updatedAt:     now,
    });

    console.log(
      `   🔄 Upserted userId=${userId} ` +
      `(wins=${totals[userId] || 0}, ` +
      `fullname="${userMeta.fullname || existing.fullname || ''}", ` +
      `email="${userMeta.email || existing.email || ''}")`
    );
  }

  // 4) Fetch all registrants now in DB
  // -----------------------------------
  console.log(`\n🗃️ Fetching registrants from DB for auction ${auctionId}...`);
  const regs = await db.getAllForAuction(auctionId);
  console.log(`✅ Found ${regs.length} registrants in DB.`);

  // NEW: 4.5) Fetch the BidJS registrants list to get registrantUuid
  console.log(`\n🔍 Fetching full registrant list for auction ${auctionId}…`);
  const regResp = await bidjsMgmtClient.get(
    `/auctions/${auctionId}/registrants`
  );
  // The API returns { message: [ { registrantUuid, userId, … }, … ] }
  const regsPayload = regResp.data.message || [];
  // Build a map: userId → registrantUuid
  const uuidByUser = regsPayload.reduce((map, r) => {
    if (r.userId && r.registrantUuid) {
      map[r.userId] = r.registrantUuid;
    }
    return map;
  }, {});
  console.log(`✅ Found ${Object.keys(uuidByUser).length} registrantUuid mappings.`);  

  // 5) Enforce limits via BidJS API
  // --------------------------------
  for (const reg of regs) {
    // Each reg has structure:
    // { auctionId, auctionUuid, userId, fullname, email,
    //   bidLimit, currentTotal, paused, updatedAt }
    const total     = reg.currentTotal;
    const bidLimit  = reg.bidLimit;
    const overLimit = bidLimit !== null && total >= bidLimit;

    console.log(`\n👤 Checking userId ${reg.userId}`);
    console.log(`   - Full name:        ${reg.fullname || '(unknown)'}`);
    console.log(`   - Email:            ${reg.email    || '(unknown)'}`);
    console.log(`   - Auction UUID:     ${reg.auctionUuid || '(none)'}`);
    console.log(`   - Bid limit:        ${bidLimit === null ? 'Unlimited' : bidLimit}`);
    console.log(`   - Current wins:     ${total}`);
    console.log(`   - Previously paused:${!!reg.paused}`);
    console.log(`   - Over limit?      ${overLimit}`);

    // Look up the true registrantUuid
    const registrantUuid = uuidByUser[reg.userId];
    if (!registrantUuid) {
      console.warn(`⚠️  No registrantUuid found for userId ${reg.userId}, skipping`);
      continue;
    }

    // Only hit BidJS if we need to change state    
    // If paused state needs changing, call the BidJS Registrant API
    if (overLimit !== Boolean(reg.paused)) {
      const newStatus = overLimit ? 4 : 2;
      console.log(`   🔄 Setting status=${newStatus} for registrantUuid=${registrantUuid}`);

      try {
        await bidjsMgmtClient.patch(
          `/v2/auctions/${auctionUuid}/registrants/${registrantUuid}`,
          { status: newStatus }
        );
        console.log(`   ✅ BidJS status updated to ${newStatus}`);
      } catch (err) {
        // Here we catch *only* errors from that patch call
        console.error(
          `   ❌ Failed to update status for registrantUuid=${registrantUuid} ` +
          `to '${newStatus}' on auction ${auctionId}:`
        );
        // If this was an HTTP error, log status & body
        if (err.response) {
          console.error(`     → HTTP ${err.response.status}`, err.response.data);
        } else {
          // Otherwise log the generic error message (network/timeout, etc)
          console.error(`     → ${err.message}`);
        }
         
        continue;
      }
    } else {
      console.log(`   ⏸️ No status change needed`);
    }
  }

  console.log(`\n✅ Enforcement complete for auction ${auctionId}\n`);
}

module.exports = { enforceLimitsForAuction };
