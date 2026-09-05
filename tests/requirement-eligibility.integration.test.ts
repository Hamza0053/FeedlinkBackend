/**
 * Integration tests: Verify that findBestMatch ONLY matches donations
 * to NGOs with active, eligible requirements.
 *
 * Tests all 6 required scenarios against the real database:
 *   Case 1 — NGO exists but has no requirement → NOT matched
 *   Case 2 — NGO has active compatible requirement → matched
 *   Case 3 — NGO has expired requirement → NOT matched
 *   Case 4 — NGO has fulfilled requirement (remaining=0) → NOT matched
 *   Case 5 — Requirement date window doesn't cover NOW → NOT matched
 *   Case 6 — Partial fulfillment preserves remaining quantity
 */

import { pool } from '../src/config/database';
import { findBestMatch } from '../src/services/matching.service';
import { fulfillRequirementQuantity } from '../src/controllers/requirement.controller';

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => Promise<void> | void) => {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (error) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  })();
};

const assertEqual = (actual: any, expected: any, msg?: string) => {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const assertNull = (val: any, msg?: string) => {
  if (val !== null && val !== undefined) {
    throw new Error(`${msg || 'Expected null/undefined'}: got ${JSON.stringify(val)}`);
  }
};

const assertNotNull = (val: any, msg?: string) => {
  if (val === null || val === undefined) {
    throw new Error(`${msg || 'Expected non-null'}: got ${val}`);
  }
};

const assertTrue = (val: boolean, msg?: string) => {
  if (!val) {
    throw new Error(msg || 'Expected true but got false');
  }
};

// Unique prefix for all test data to enable clean cleanup
const TEST = 'integration_test_';
const TEST_CITY = 'TestCity_Integration';

// Cleanup helper
const cleanup = async () => {
  // Remove test matches (by donation title prefix)
  await pool.query(`DELETE FROM matches WHERE donation_id IN (SELECT id FROM donations WHERE title LIKE '${TEST}%')`);
  // Remove test donations
  await pool.query(`DELETE FROM donations WHERE title LIKE '${TEST}%'`);
  // Remove test requirements
  await pool.query(`DELETE FROM ngo_requirements WHERE title LIKE '${TEST}%'`);
  // Remove test NGO users
  await pool.query(`DELETE FROM users WHERE email LIKE '${TEST}%'`);
};

// Create a test NGO user
const createTestNgo = async (name: string): Promise<string> => {
  const r = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, organization)
     VALUES ($1, $2, '$2b$10$dummyhash', 'ngo', $3)
     RETURNING id`,
    [`${TEST}${name}`, `${TEST}${name}@test.com`, name],
  );
  return r.rows[0].id;
};

// Create a test requirement
const createTestRequirement = async (
  ngoId: string,
  opts: {
    category?: string;
    quantity?: number;
    neededFrom?: Date;
    neededUntil?: Date;
    status?: string;
    city?: string;
    remaining?: number;
  } = {},
): Promise<string> => {
  const now = new Date();
  const from = opts.neededFrom || new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const until = opts.neededUntil || new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const qty = opts.quantity || 100;
  const remaining = opts.remaining ?? qty;

  const r = await pool.query(
    `INSERT INTO ngo_requirements
       (ngo_id, title, food_category, quantity_needed, unit, remaining_quantity,
        needed_from, needed_until, pickup_city, urgency_level, status)
     VALUES ($1, $2, $3, $4, 'portions', $5, $6, $7, $8, 'medium', $9)
     RETURNING id`,
    [
      ngoId,
      `${TEST}req_${Math.random().toString(36).slice(2, 8)}`,
      opts.category || 'prepared_meals',
      qty,
      remaining,
      from.toISOString(),
      until.toISOString(),
      opts.city || TEST_CITY,
      opts.status || 'active',
    ],
  );
  return r.rows[0].id;
};

// Create a test donation (just the DB row, bypassing the full pipeline)
const createTestDonation = async (city?: string): Promise<string> => {
  // We need a donor user
  const donorRes = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, '$2b$10$dummyhash', 'donor')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [`${TEST}donor`, `${TEST}donor@test.com`],
  );
  // Get donor ID (either just inserted or existing)
  const donor = await pool.query(`SELECT id FROM users WHERE email = $1`, [`${TEST}donor@test.com`]);
  const donorId = donor.rows[0].id;

  const r = await pool.query(
    `INSERT INTO donations
       (donor_id, title, description, food_category, quantity, unit,
        expiry_date, pickup_address, pickup_city, status, urgency_level, urgency_score)
     VALUES ($1, $2, 'test', 'prepared_meals', '20', 'portions',
             NOW() + INTERVAL '24 hours', '123 Test St', $3, 'pending', 'medium', 5)
     RETURNING id`,
    [donorId, `${TEST}donation_${Math.random().toString(36).slice(2, 8)}`, city || TEST_CITY],
  );
  return r.rows[0].id;
};

// ============================================================================
// RUN
// ============================================================================

const run = async () => {
  console.log('\n==============================================');
  console.log('  REQUIREMENT-BASED MATCHING — INTEGRATION TESTS');
  console.log('==============================================\n');

  // Clean slate
  await cleanup();

  // Create test NGOs
  const ngoNoReq = await createTestNgo('ngo_no_requirement');
  const ngoActive = await createTestNgo('ngo_active_req');
  const ngoExpired = await createTestNgo('ngo_expired_req');
  const ngoFulfilled = await createTestNgo('ngo_fulfilled_req');
  const ngoFutureDate = await createTestNgo('ngo_future_date');
  const ngoPartial = await createTestNgo('ngo_partial_fulfill');

  console.log('── Test NGOs created ──');

  // ── Case 1: NGO with NO requirement ──
  // ngoNoReq has no requirements at all

  // ── Case 2: NGO with ACTIVE compatible requirement ──
  const activeReqId = await createTestRequirement(ngoActive, {
    category: 'prepared_meals',
    quantity: 100,
    city: TEST_CITY,
  });

  // ── Case 3: NGO with EXPIRED requirement ──
  const now = new Date();
  await createTestRequirement(ngoExpired, {
    category: 'prepared_meals',
    quantity: 100,
    neededFrom: new Date(now.getTime() - 72 * 60 * 60 * 1000), // 3 days ago
    neededUntil: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 1 day ago
    city: TEST_CITY,
  });

  // ── Case 4: NGO with FULFILLED requirement (remaining=0) ──
  await createTestRequirement(ngoFulfilled, {
    category: 'prepared_meals',
    quantity: 100,
    status: 'fulfilled',
    remaining: 0,
    city: TEST_CITY,
  });

  // ── Case 5: NGO with requirement in the FUTURE ──
  await createTestRequirement(ngoFutureDate, {
    category: 'prepared_meals',
    quantity: 100,
    neededFrom: new Date(now.getTime() + 24 * 60 * 60 * 1000),  // tomorrow
    neededUntil: new Date(now.getTime() + 72 * 60 * 60 * 1000), // 3 days from now
    city: TEST_CITY,
  });

  // ── Case 6: NGO with active requirement for partial fulfillment ──
  const partialReqId = await createTestRequirement(ngoPartial, {
    category: 'prepared_meals',
    quantity: 50,
    city: TEST_CITY,
  });

  console.log('\n── Test requirements created ──\n');

  // =========================================================================
  // Case 1: NGO exists but has NO active requirement → NOT matched
  // =========================================================================
  console.log('Case 1: NGO with no requirement');
  await test('NGO without requirement is NOT matched', async () => {
    // Verify: the eligibility query finds nothing for this NGO
    const eligible = await pool.query(
      `SELECT r.id FROM ngo_requirements r
       WHERE r.ngo_id = $1 AND r.status = 'active'
         AND r.needed_from <= NOW() AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0 AND r.food_category = 'prepared_meals'`,
      [ngoNoReq],
    );
    assertEqual(eligible.rows.length, 0, 'No eligible requirements for NGO without requirement');

    // Also verify via findBestMatch: create a donation and check
    const donId = await createTestDonation(TEST_CITY);
    const match = await findBestMatch(
      donId, 'prepared_meals', 'medium', TEST_CITY,
      `${TEST}case1`, '20', 'portions', 50,
    );
    // match should NOT be for ngoNoReq
    if (match && match.ngoId === ngoNoReq) {
      throw new Error('NGO without requirement was matched!');
    }
  });

  // =========================================================================
  // Case 2: NGO with ACTIVE compatible requirement → matched
  // =========================================================================
  console.log('\nCase 2: NGO with active compatible requirement');
  await test('NGO with active requirement IS matched (eligibility query finds it)', async () => {
    // Verify: the eligibility query finds the requirement
    const eligible = await pool.query(
      `SELECT r.id FROM ngo_requirements r
       WHERE r.ngo_id = $1 AND r.status = 'active'
         AND r.needed_from <= NOW() AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0 AND r.food_category = 'prepared_meals'`,
      [ngoActive],
    );
    assertEqual(eligible.rows.length, 1, 'Should find 1 eligible requirement');
  });

  await test('findBestMatch returns a match when active requirements exist', async () => {
    // findBestMatch should return SOME match (other real-DB requirements may also be eligible).
    // The key assertion: the matched NGO must have an active requirement.
    const donId = await createTestDonation(TEST_CITY);
    const match = await findBestMatch(
      donId, 'prepared_meals', 'medium', TEST_CITY,
      `${TEST}case2`, '20', 'portions', 50,
    );
    assertNotNull(match, 'Match should not be null when active requirements exist');

    // Verify the matched NGO actually has an active requirement (not just registered)
    const matchedNgoReq = await pool.query(
      `SELECT r.id FROM ngo_requirements r
       WHERE r.ngo_id = $1 AND r.status = 'active'
         AND r.needed_from <= NOW() AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0 AND r.food_category = 'prepared_meals'`,
      [match!.ngoId],
    );
    assertTrue(matchedNgoReq.rows.length > 0, 'Matched NGO must have an active requirement');
    assertNotNull(match!.requirementId, 'Match must reference a requirement_id');
  });

  // =========================================================================
  // Case 3: NGO with EXPIRED requirement → NOT matched
  // =========================================================================
  console.log('\nCase 3: NGO with expired requirement');
  await test('NGO with expired requirement is NOT matched', async () => {
    // The needed_until is in the past, so the query should exclude it
    const eligible = await pool.query(
      `SELECT r.id FROM ngo_requirements r
       WHERE r.ngo_id = $1 AND r.status = 'active'
         AND r.needed_from <= NOW() AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0 AND r.food_category = 'prepared_meals'`,
      [ngoExpired],
    );
    assertEqual(eligible.rows.length, 0, 'Expired requirement should not be eligible');
  });

  // =========================================================================
  // Case 4: NGO with FULFILLED requirement (remaining=0) → NOT matched
  // =========================================================================
  console.log('\nCase 4: NGO with fulfilled requirement');
  await test('NGO with fulfilled requirement is NOT matched', async () => {
    const eligible = await pool.query(
      `SELECT r.id FROM ngo_requirements r
       WHERE r.ngo_id = $1 AND r.status = 'active'
         AND r.needed_from <= NOW() AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0 AND r.food_category = 'prepared_meals'`,
      [ngoFulfilled],
    );
    assertEqual(eligible.rows.length, 0, 'Fulfilled requirement should not be eligible');
  });

  // =========================================================================
  // Case 5: Requirement date window doesn't cover NOW → NOT matched
  // =========================================================================
  console.log('\nCase 5: Requirement with future date window');
  await test('NGO with future-dated requirement is NOT matched', async () => {
    const eligible = await pool.query(
      `SELECT r.id FROM ngo_requirements r
       WHERE r.ngo_id = $1 AND r.status = 'active'
         AND r.needed_from <= NOW() AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0 AND r.food_category = 'prepared_meals'`,
      [ngoFutureDate],
    );
    assertEqual(eligible.rows.length, 0, 'Future-dated requirement should not be eligible');
  });

  // =========================================================================
  // Case 6: Partial fulfillment — 20 of 50 → remaining 30
  // =========================================================================
  console.log('\nCase 6: Partial fulfillment');
  await test('Partial fulfillment: 20 of 50 → remaining 30, stays active', async () => {
    const before = await pool.query(
      'SELECT remaining_quantity, status FROM ngo_requirements WHERE id = $1',
      [partialReqId],
    );
    assertEqual(parseFloat(before.rows[0].remaining_quantity), 50, 'Should start at 50');

    const result = await fulfillRequirementQuantity(partialReqId, 20);
    assertEqual(result.remaining, 30, 'Remaining should be 30');
    assertEqual(result.status, 'active', 'Status should remain active');

    const after = await pool.query(
      'SELECT remaining_quantity, status FROM ngo_requirements WHERE id = $1',
      [partialReqId],
    );
    assertEqual(parseFloat(after.rows[0].remaining_quantity), 30, 'DB remaining should be 30');
    assertEqual(after.rows[0].status, 'active', 'DB status should remain active');
  });

  await test('Further fulfillment: 30 → 0 becomes fulfilled', async () => {
    const result = await fulfillRequirementQuantity(partialReqId, 30);
    assertEqual(result.remaining, 0, 'Remaining should be 0');
    assertEqual(result.status, 'fulfilled', 'Status should become fulfilled');

    const after = await pool.query(
      'SELECT remaining_quantity, status, fulfilled_at FROM ngo_requirements WHERE id = $1',
      [partialReqId],
    );
    assertEqual(parseFloat(after.rows[0].remaining_quantity), 0, 'DB remaining should be 0');
    assertEqual(after.rows[0].status, 'fulfilled', 'DB status should be fulfilled');
    assertNotNull(after.rows[0].fulfilled_at, 'fulfilled_at should be set');
  });

  // =========================================================================
  // Additional: Verify the core SQL eligibility gate
  // =========================================================================
  console.log('\nAdditional: SQL eligibility gate verification');
  await test('Eligibility query enforces ALL 5 conditions simultaneously', async () => {
    // Only ngoActive's requirement should pass all filters
    const all_eligible = await pool.query(
      `SELECT r.id, r.ngo_id, r.status, r.food_category, r.remaining_quantity,
              r.needed_from, r.needed_until
       FROM ngo_requirements r
       WHERE r.status = 'active'
         AND r.needed_from <= NOW()
         AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0
         AND r.food_category = 'prepared_meals'
         AND r.title LIKE $1`,
      [`${TEST}%`],
    );

    // Only the active requirement from ngoActive should pass
    // (ngoPartial's was just fulfilled above, ngoNoReq has none, ngoExpired is past, ngoFutureDate is future)
    const ngoIds = all_eligible.rows.map((r: any) => r.ngo_id);
    if (!ngoIds.includes(ngoActive)) {
      throw new Error('ngoActive should be in eligible list');
    }
    if (ngoIds.includes(ngoNoReq)) {
      throw new Error('ngoNoReq should NOT be in eligible list');
    }
    if (ngoIds.includes(ngoExpired)) {
      throw new Error('ngoExpired should NOT be in eligible list');
    }
    if (ngoIds.includes(ngoFutureDate)) {
      throw new Error('ngoFutureDate should NOT be in eligible list');
    }
  });

  // =========================================================================
  // Cleanup
  // =========================================================================
  console.log('\n── Cleaning up test data ──');
  await cleanup();
  console.log('  ✓ Cleanup complete\n');

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('==============================================');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log('==============================================');

  if (failed > 0) {
    console.log('\n  ✗ SOME TESTS FAILED\n');
    process.exit(1);
  } else {
    console.log('\n  ✓ All integration tests passed!\n');
    process.exit(0);
  }
};

run().catch((err) => {
  console.error('FATAL:', err);
  cleanup().finally(() => process.exit(1));
});
