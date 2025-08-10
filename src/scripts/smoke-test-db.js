// scripts/smoke-test-db.js
const dbHelpers   = require('../db');             // your helper module

(async () => {
  try {
    console.log('🏁 Initializing smoke test…');

    const A  = 'TEST_AUCTION';
    const U  = 'TEST_USER';
    const L1 = 'LOT1', L2 = 'LOT2';

    // 1. Seed registrant with limit = 2
    await dbHelpers.setRegistrant(A, U, { limit: 2, status: 'QUALIFIED' });
    console.log('• Seeded registrant with limit = 2');

    // 2. Simulate two winning bids
    await dbHelpers.upsertCurrentHighest(A, L1, 'BID1', U);
    await dbHelpers.upsertCurrentHighest(A, L2, 'BID2', U);
    console.log('• Simulated wins on LOT1 and LOT2');

    // 3. Count active lots
    const cnt = await dbHelpers.countActiveLots(A, U);
    console.log(`• Active lots count for ${U}:`, cnt);

    // 4. Check limit enforcement
    if (cnt + 1 > 2) {
      console.log('✅ Limit correctly detected: blocking a third lot');
    } else {
      console.error('❌ Limit check failed');
    }

    // 5. Simulate out-bid on LOT1 by another user, U2
    const U2 = 'OTHER_USER';
    await dbHelpers.upsertCurrentHighest(A, L1, 'BID3', U2);
    console.log('• Simulated out-bid on LOT1 by OTHER_USER');

    // 6. Re-count for original user
    const cnt2 = await dbHelpers.countActiveLots(A, U);
    console.log(`• Active lots count for ${U} after out-bid:`, cnt2);

    if (cnt2 === 1) {
      console.log('✅ Out-bid correctly freed up a slot');
    } else {
      console.error('❌ Out-bid handling failed');
    }

    console.log('🏁 Smoke test complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error during smoke test:', err);
    process.exit(1);
  }
})();
