/**
 * Tests for NGO Matching Service - City Extraction and Comparison
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
// extractCityFromAddress Tests
// ============================================================================

console.log('\n=== extractCityFromAddress Tests ===\n');

test('Extracts city from "123 Main St, New York, NY 10001"', () => {
  const result = extractCityFromAddress('123 Main St, New York, NY 10001');
  assertEqual(result, 'New York');
});

test('Extracts city from "456 Restaurant Row, New York"', () => {
  const result = extractCityFromAddress('456 Restaurant Row, New York');
  assertEqual(result, 'New York');
});

test('Extracts city from "Faisalabad, Pakistan"', () => {
  const result = extractCityFromAddress('Faisalabad, Pakistan');
  assertEqual(result, 'Faisalabad');
});

test('Extracts city from "789 Elm St, Los Angeles, CA 90210"', () => {
  const result = extractCityFromAddress('789 Elm St, Los Angeles, CA 90210');
  assertEqual(result, 'Los Angeles');
});

test('Extracts city from "Faisalabad" (single part)', () => {
  const result = extractCityFromAddress('Faisalabad');
  assertEqual(result, 'Faisalabad');
});

test('Returns null for empty string', () => {
  const result = extractCityFromAddress('');
  assertEqual(result, null);
});

test('Returns null for null/undefined', () => {
  const result = extractCityFromAddress(null as any);
  assertEqual(result, null);
});

test('Extracts city from "100 Charity Lane, East Side"', () => {
  const result = extractCityFromAddress('100 Charity Lane, East Side');
  assertEqual(result, 'East Side');
});

// ============================================================================
// normalizeCityName Tests
// ============================================================================

console.log('\n=== normalizeCityName Tests ===\n');

test('Normalizes "New York" to lowercase', () => {
  const result = normalizeCityName('New York');
  assertEqual(result, 'new york');
});

test('Removes punctuation from "New York, "', () => {
  const result = normalizeCityName('New York, ');
  assertEqual(result, 'new york');
});

test('Removes state codes from "New York NY"', () => {
  const result = normalizeCityName('New York NY');
  assertEqual(result, 'new york');
});

test('Removes state codes with zip from "Los Angeles CA 90210"', () => {
  const result = normalizeCityName('Los Angeles CA 90210');
  assertEqual(result, 'los angeles');
});

test('Normalizes whitespace', () => {
  const result = normalizeCityName('  New   York  ');
  assertEqual(result, 'new york');
});

test('Returns empty string for null/undefined', () => {
  const result = normalizeCityName(null as any);
  assertEqual(result, '');
});

// ============================================================================
// levenshteinDistance Tests
// ============================================================================

console.log('\n=== levenshteinDistance Tests ===\n');

test('Distance between identical strings is 0', () => {
  const result = levenshteinDistance('faisalabad', 'faisalabad');
  assertEqual(result, 0);
});

test('Distance between "faisalabad" and "faisbad" is 3', () => {
  const result = levenshteinDistance('faisalabad', 'faisbad');
  assertEqual(result, 3);
});

test('Distance between "kitten" and "sitting" is 3', () => {
  const result = levenshteinDistance('kitten', 'sitting');
  assertEqual(result, 3);
});

test('Distance between empty string and "abc" is 3', () => {
  const result = levenshteinDistance('', 'abc');
  assertEqual(result, 3);
});

test('Distance between "abc" and empty string is 3', () => {
  const result = levenshteinDistance('abc', '');
  assertEqual(result, 3);
});

// ============================================================================
// citiesMatch Tests
// ============================================================================

console.log('\n=== citiesMatch Tests ===\n');

test('Exact match: "Faisalabad" vs "Faisalabad"', () => {
  assertTrue(citiesMatch('Faisalabad', 'Faisalabad'));
});

test('Case insensitive: "FAISALABAD" vs "faisalabad"', () => {
  assertTrue(citiesMatch('FAISALABAD', 'faisalabad'));
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

test('With address format: "New York" vs "123 Main St, New York, NY 10001"', () => {
  const city1 = 'New York';
  const city2 = extractCityFromAddress('123 Main St, New York, NY 10001');
  assertTrue(city2 !== null && citiesMatch(city1, city2));
});

test('Different cities: "New York" vs "Los Angeles"', () => {
  assertFalse(citiesMatch('New York', 'Los Angeles'));
});

test('Different cities with typos: "Faisalabad" vs "Islamabad"', () => {
  assertFalse(citiesMatch('Faisalabad', 'Islamabad'));
});

test('Empty strings should not match', () => {
  assertFalse(citiesMatch('', 'New York'));
  assertFalse(citiesMatch('New York', ''));
  assertFalse(citiesMatch('', ''));
});

test('Punctuation tolerance: "New York" vs "New York, "', () => {
  assertTrue(citiesMatch('New York', 'New York, '));
});

test('State code tolerance: "New York" vs "New York NY"', () => {
  assertTrue(citiesMatch('New York', 'New York NY'));
});

// ============================================================================
// Integration Tests
// ============================================================================

console.log('\n=== Integration Tests ===\n');

test('Full flow: Extract and compare "New York" from address', () => {
  const address = '123 Main St, New York, NY 10001';
  const donationCity = 'New York';
  
  const extractedCity = extractCityFromAddress(address);
  assertTrue(extractedCity !== null, 'City should be extracted');
  assertTrue(citiesMatch(extractedCity!, donationCity), 'Cities should match');
});

test('Full flow: Typo in donation city "Faisbad" vs extracted "Faisalabad"', () => {
  const address = 'Faisalabad, Pakistan';
  const donationCity = 'Faisbad';
  
  const extractedCity = extractCityFromAddress(address);
  assertTrue(extractedCity !== null, 'City should be extracted');
  assertTrue(citiesMatch(extractedCity!, donationCity), 'Cities should match despite typo');
});

test('Full flow: Complex address with state and zip', () => {
  const address = '456 Restaurant Row, Los Angeles, CA 90210';
  const donationCity = 'Los Angeles';
  
  const extractedCity = extractCityFromAddress(address);
  assertTrue(extractedCity !== null, 'City should be extracted');
  assertEqual(extractedCity, 'Los Angeles');
  assertTrue(citiesMatch(extractedCity!, donationCity), 'Cities should match');
});

// ============================================================================
// Deterministic Matching Tests
// ============================================================================

console.log('\n=== Deterministic Matching Tests ===\n');

test('Deterministic: Same inputs produce same city extraction', () => {
  const address = '123 Main St, New York, NY 10001';
  const result1 = extractCityFromAddress(address);
  const result2 = extractCityFromAddress(address);
  const result3 = extractCityFromAddress(address);
  
  assertEqual(result1, result2, 'First and second extraction should match');
  assertEqual(result2, result3, 'Second and third extraction should match');
  assertEqual(result1, 'New York', 'Should extract correct city');
});

test('Deterministic: Same city comparison produces same result', () => {
  const city1 = 'Faisalabad';
  const city2 = 'Faisbad';
  
  const result1 = citiesMatch(city1, city2);
  const result2 = citiesMatch(city1, city2);
  const result3 = citiesMatch(city1, city2);
  
  assertTrue(result1 === result2, 'First and second comparison should match');
  assertTrue(result2 === result3, 'Second and third comparison should match');
  assertTrue(result1, 'Should match despite typo');
});

test('Deterministic: Normalization is consistent', () => {
  const city = 'New York';
  const result1 = normalizeCityName(city);
  const result2 = normalizeCityName(city);
  const result3 = normalizeCityName(city);
  
  assertEqual(result1, result2, 'First and second normalization should match');
  assertEqual(result2, result3, 'Second and third normalization should match');
  assertEqual(result1, 'new york', 'Should normalize correctly');
});

test('Deterministic: Levenshtein distance is consistent', () => {
  const str1 = 'faisalabad';
  const str2 = 'faisbad';
  
  const result1 = levenshteinDistance(str1, str2);
  const result2 = levenshteinDistance(str1, str2);
  const result3 = levenshteinDistance(str1, str2);
  
  assertEqual(result1, result2, 'First and second distance should match');
  assertEqual(result2, result3, 'Second and third distance should match');
  assertEqual(result1, 3, 'Distance should be 3');
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
