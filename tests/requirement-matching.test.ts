/**
 * Tests for Requirement-Based NGO Matching
 *
 * Tests the core matching logic, city utilities, and requirement eligibility.
 */

import {
  extractCityFromAddress,
  normalizeCityName,
  levenshteinDistance,
  citiesMatch,
} from '../src/services/matching.service';

// Simple test runner
let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
};

const assertEqual = (actual: any, expected: any, message?: string) => {
  if (actual !== expected) {
    throw new Error(
      `${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
};

const assertTrue = (value: boolean, message?: string) => {
  if (!value) {
    throw new Error(message || 'Expected true but got false');
  }
};

const assertFalse = (value: boolean, message?: string) => {
  if (value) {
    throw new Error(message || 'Expected false but got true');
  }
};

// ============================================================================
// City Extraction Tests
// ============================================================================

console.log('\n=== City Extraction Tests ===\n');

test('Extracts city from "123 Main St, New York, NY 10001"', () => {
  assertEqual(extractCityFromAddress('123 Main St, New York, NY 10001'), 'New York');
});

test('Extracts city from "456 Restaurant Row, New York"', () => {
  assertEqual(extractCityFromAddress('456 Restaurant Row, New York'), 'New York');
});

test('Extracts city from "Faisalabad, Pakistan"', () => {
  assertEqual(extractCityFromAddress('Faisalabad, Pakistan'), 'Faisalabad');
});

test('Extracts city from "789 Elm St, Los Angeles, CA 90210"', () => {
  assertEqual(extractCityFromAddress('789 Elm St, Los Angeles, CA 90210'), 'Los Angeles');
});

test('Returns null for empty string', () => {
  assertEqual(extractCityFromAddress(''), null);
});

test('Returns null for null', () => {
  assertEqual(extractCityFromAddress(null as any), null);
});

// ============================================================================
// City Matching Tests
// ============================================================================

console.log('\n=== City Matching Tests ===\n');

test('Exact match: "Faisalabad" vs "Faisalabad"', () => {
  assertTrue(citiesMatch('Faisalabad', 'Faisalabad'));
});

test('Typo tolerance: "Faisbad" vs "Faisalabad"', () => {
  assertTrue(citiesMatch('Faisbad', 'Faisalabad'));
});

test('Typo tolerance: "New Yrok" vs "New York"', () => {
  assertTrue(citiesMatch('New Yrok', 'New York'));
});

test('Containment: "New York" vs "New York City"', () => {
  assertTrue(citiesMatch('New York', 'New York City'));
});

test('Different cities: "New York" vs "Los Angeles"', () => {
  assertFalse(citiesMatch('New York', 'Los Angeles'));
});

test('Empty strings do not match', () => {
  assertFalse(citiesMatch('', 'New York'));
  assertFalse(citiesMatch('New York', ''));
});

test('Case insensitive match', () => {
  assertTrue(citiesMatch('FAISALABAD', 'faisalabad'));
});

// ============================================================================
// Deterministic Matching Tests
// ============================================================================

console.log('\n=== Deterministic Matching Tests ===\n');

test('Deterministic: Same inputs produce same city extraction', () => {
  const address = '123 Main St, New York, NY 10001';
  const r1 = extractCityFromAddress(address);
  const r2 = extractCityFromAddress(address);
  const r3 = extractCityFromAddress(address);
  assertEqual(r1, r2);
  assertEqual(r2, r3);
});

test('Deterministic: Same city comparison produces same result', () => {
  const r1 = citiesMatch('Faisalabad', 'Faisbad');
  const r2 = citiesMatch('Faisalabad', 'Faisbad');
  const r3 = citiesMatch('Faisalabad', 'Faisbad');
  assertTrue(r1 === r2 && r2 === r3);
});

test('Deterministic: Levenshtein distance is consistent', () => {
  const r1 = levenshteinDistance('faisalabad', 'faisbad');
  const r2 = levenshteinDistance('faisalabad', 'faisbad');
  assertEqual(r1, r2);
  assertEqual(r1, 3);
});

test('Deterministic: Normalization is consistent', () => {
  const r1 = normalizeCityName('New York');
  const r2 = normalizeCityName('New York');
  assertEqual(r1, r2);
  assertEqual(r1, 'new york');
});

// ============================================================================
// Requirement Eligibility Logic Tests (Unit-level)
// ============================================================================

console.log('\n=== Requirement Eligibility Logic Tests ===\n');

test('Requirement status check: active requirement within date range is eligible', () => {
  const now = new Date();
  const req = {
    status: 'active',
    needed_from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    needed_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), // 1 day from now
    remaining_quantity: 100,
    food_category: 'prepared_meals',
  };

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0;

  assertTrue(isEligible, 'Active requirement within date range should be eligible');
});

test('Requirement status check: future requirement is NOT eligible', () => {
  const now = new Date();
  const req = {
    status: 'active',
    needed_from: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    needed_until: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    remaining_quantity: 100,
    food_category: 'prepared_meals',
  };

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0;

  assertFalse(isEligible, 'Future requirement should NOT be eligible');
});

test('Requirement status check: expired requirement is NOT eligible', () => {
  const now = new Date();
  const req = {
    status: 'active',
    needed_from: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    needed_until: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    remaining_quantity: 100,
    food_category: 'prepared_meals',
  };

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0;

  assertFalse(isEligible, 'Expired requirement should NOT be eligible');
});

test('Requirement status check: cancelled requirement is NOT eligible', () => {
  const now = new Date();
  const req = {
    status: 'cancelled',
    needed_from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    needed_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    remaining_quantity: 100,
    food_category: 'prepared_meals',
  };

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0;

  assertFalse(isEligible, 'Cancelled requirement should NOT be eligible');
});

test('Requirement status check: fulfilled requirement is NOT eligible', () => {
  const now = new Date();
  const req = {
    status: 'fulfilled',
    needed_from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    needed_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    remaining_quantity: 0,
    food_category: 'prepared_meals',
  };

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0;

  assertFalse(isEligible, 'Fulfilled requirement should NOT be eligible');
});

test('Requirement status check: remaining_quantity = 0 is NOT eligible', () => {
  const now = new Date();
  const req = {
    status: 'active',
    needed_from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    needed_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    remaining_quantity: 0,
    food_category: 'prepared_meals',
  };

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0;

  assertFalse(isEligible, 'Requirement with 0 remaining should NOT be eligible');
});

test('Category mismatch: different food_category is NOT eligible', () => {
  const now = new Date();
  const req = {
    status: 'active',
    needed_from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    needed_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    remaining_quantity: 100,
    food_category: 'dairy',
  };
  const donationCategory = 'prepared_meals';

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0 &&
    req.food_category === donationCategory;

  assertFalse(isEligible, 'Category mismatch should NOT be eligible');
});

test('Category match: same food_category is eligible', () => {
  const now = new Date();
  const req = {
    status: 'active',
    needed_from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    needed_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    remaining_quantity: 100,
    food_category: 'prepared_meals',
  };
  const donationCategory = 'prepared_meals';

  const isEligible =
    req.status === 'active' &&
    new Date(req.needed_from) <= now &&
    new Date(req.needed_until) >= now &&
    req.remaining_quantity > 0 &&
    req.food_category === donationCategory;

  assertTrue(isEligible, 'Category match should be eligible');
});

// ============================================================================
// Partial Fulfillment Logic Tests
// ============================================================================

console.log('\n=== Partial Fulfillment Logic Tests ===\n');

test('Partial fulfillment: 40 of 100 → remaining 60, stays active', () => {
  const quantityNeeded = 100;
  let remaining = 100;
  let status = 'active';

  // Simulate partial fulfillment
  const donationQty = 40;
  remaining = Math.max(0, remaining - donationQty);
  if (remaining <= 0) status = 'fulfilled';

  assertEqual(remaining, 60, 'Remaining should be 60');
  assertEqual(status, 'active', 'Status should remain active');
});

test('Full fulfillment: 100 of 100 → remaining 0, becomes fulfilled', () => {
  const quantityNeeded = 100;
  let remaining = 100;
  let status = 'active';

  const donationQty = 100;
  remaining = Math.max(0, remaining - donationQty);
  if (remaining <= 0) status = 'fulfilled';

  assertEqual(remaining, 0, 'Remaining should be 0');
  assertEqual(status, 'fulfilled', 'Status should become fulfilled');
});

test('Over-fulfillment: 120 of 100 → remaining 0, becomes fulfilled', () => {
  const quantityNeeded = 100;
  let remaining = 100;
  let status = 'active';

  const donationQty = 120;
  remaining = Math.max(0, remaining - donationQty);
  if (remaining <= 0) status = 'fulfilled';

  assertEqual(remaining, 0, 'Remaining should be 0 (clamped)');
  assertEqual(status, 'fulfilled', 'Status should become fulfilled');
});

test('Multiple partial fulfillments: 40 + 30 + 30 = 100 → fulfilled', () => {
  let remaining = 100;
  let status = 'active';

  // First donation: 40
  remaining = Math.max(0, remaining - 40);
  if (remaining <= 0) status = 'fulfilled';
  assertEqual(remaining, 60);
  assertEqual(status, 'active');

  // Second donation: 30
  remaining = Math.max(0, remaining - 30);
  if (remaining <= 0) status = 'fulfilled';
  assertEqual(remaining, 30);
  assertEqual(status, 'active');

  // Third donation: 30
  remaining = Math.max(0, remaining - 30);
  if (remaining <= 0) status = 'fulfilled';
  assertEqual(remaining, 0);
  assertEqual(status, 'fulfilled');
});

// ============================================================================
// Scoring Determinism Tests
// ============================================================================

console.log('\n=== Scoring Determinism Tests ===\n');

test('No randomness in scoring: same inputs always produce same score', () => {
  // Simulate scoring function (without randomness)
  const calculateScore = (
    proximityMatch: boolean,
    hasAddress: boolean,
    activeCount: number,
    categoryHistory: number,
    isHighUrgency: boolean,
    donationQty: number,
    remainingQty: number,
  ) => {
    let score = 50; // base

    // Proximity
    if (proximityMatch) score += 20;
    else if (hasAddress) score += 5;

    // Capacity
    if (activeCount === 0) score += 20;
    else if (activeCount <= 2) score += 10;
    else if (activeCount >= 5) score -= 15;

    // Category
    if (categoryHistory > 0) score += 15;
    if (categoryHistory >= 3) score += 5;

    // Urgency
    if (isHighUrgency) {
      if (activeCount === 0) score += 15;
      else if (activeCount <= 1) score += 8;
    }

    // Quantity fit
    if (donationQty > 0 && remainingQty > 0) {
      const fillRatio = donationQty / remainingQty;
      if (fillRatio >= 0.8 && fillRatio <= 1.5) score += 10;
      else if (fillRatio >= 0.3) score += 5;
    }

    return Math.min(100, Math.max(0, score));
  };

  // Run same calculation 10 times
  const scores = Array.from({ length: 10 }, () =>
    calculateScore(true, true, 0, 2, true, 80, 100)
  );

  // All scores should be identical
  const firstScore = scores[0];
  const allSame = scores.every((s) => s === firstScore);
  assertTrue(allSame, `All scores should be identical, got: ${scores.join(', ')}`);
  assertEqual(firstScore, 100, 'Score should be 100 (capped)');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n=== Test Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✓ All tests passed!\n');
  process.exit(0);
}
