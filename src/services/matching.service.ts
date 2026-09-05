/**
 * Smart NGO Matching Service — Requirement-Based Matching
 *
 * Matches donations against ACTIVE NGO receiving requirements, not just
 * registered NGOs. An NGO must have an active requirement to be eligible.
 *
 * Eligibility filter (applied BEFORE scoring):
 *   - status = 'active'
 *   - needed_from <= NOW()
 *   - needed_until >= NOW()
 *   - remaining_quantity > 0
 *   - food_category matches donation
 *
 * Scoring factors:
 *   1. Proximity   (requirement city vs donation city → bonus)
 *   2. Urgency fit (requirement urgency vs donation urgency)
 *   3. Quantity fit (how well donation quantity fills the requirement)
 *   4. NGO capacity (fewer other active donations → higher score)
 *   5. Category history (NGO's past success with this food category)
 *
 * If Gemini is available, an AI explanation is generated for the top match.
 * If Gemini is unavailable, a deterministic explanation is built from the factors.
 */

import { pool } from '../config/database';
import { explainNgoMatch } from './gemini.service';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface MatchResult {
  ngoId: string;
  ngoName: string;
  requirementId: string | null;
  matchScore: number;
  matchExplanation: string;
  matchFactors: string[];
}

// ---------------------------------------------------------------------------
// City extraction and comparison utilities
// ---------------------------------------------------------------------------

/**
 * Extract city name from a full address string.
 * Handles formats like:
 * - "123 Main St, New York, NY 10001" -> "New York"
 * - "456 Restaurant Row, New York" -> "New York"
 * - "Faisalabad, Pakistan" -> "Faisalabad"
 */
export const extractCityFromAddress = (address: string): string | null => {
  if (!address || !address.trim()) return null;

  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // If only one part, that's the city
  if (parts.length === 1) return parts[0];

  // If two parts, check if first part looks like a street address
  // (starts with number or contains words like St, Street, Ave, Road, Lane, etc.)
  if (parts.length === 2) {
    const firstPart = parts[0];
    const isStreetAddress = /^\d+/.test(firstPart) || 
      /\b(street|st|ave|avenue|road|rd|lane|ln|blvd|drive|dr)\b/i.test(firstPart);
    
    if (isStreetAddress) {
      // Format: "Street, City" -> return second part
      return parts[1];
    }
    // Format: "City, Country" -> return first part
    return parts[0];
  }

  // For 3+ parts, city is typically second-to-last or second part
  // Check if last part looks like a state/zip (e.g., "NY 10001", "CA", "Pakistan")
  const lastPart = parts[parts.length - 1];
  const hasStateZip = /^([A-Z]{2}\s*\d{0,5}|[A-Z]{2}|\d{5,})$/i.test(lastPart);

  if (hasStateZip && parts.length >= 3) {
    // Format: "Street, City, State ZIP" -> city is second-to-last
    return parts[parts.length - 2];
  }

  // Otherwise, assume city is the second part (index 1)
  // Format: "Street, City, Country" or "Street, City"
  return parts[1] || parts[0];
};

/**
 * Normalize city name for comparison.
 * - Lowercase
 * - Trim whitespace
 * - Remove common punctuation
 * - Remove state/zip codes if present
 */
export const normalizeCityName = (city: string): string => {
  if (!city) return '';
  return city
    .toLowerCase()
    .trim()
    .replace(/[.,;:()]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\b[A-Z]{2}\s*\d*\b/gi, '') // Remove state codes like "NY", "CA 90210"
    .trim();
};

/**
 * Calculate Levenshtein distance between two strings.
 * Used for typo-tolerant city matching.
 */
export const levenshteinDistance = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

/**
 * Check if two city names match (with typo tolerance).
 * Returns true if:
 * - Exact match after normalization
 * - One contains the other (e.g., "New York" in "New York City")
 * - Levenshtein distance is small relative to string length (typo tolerance)
 */
export const citiesMatch = (city1: string, city2: string): boolean => {
  const norm1 = normalizeCityName(city1);
  const norm2 = normalizeCityName(city2);

  if (!norm1 || !norm2) return false;

  // Exact match
  if (norm1 === norm2) return true;

  // Containment check (e.g., "New York" matches "New York City")
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // Typo tolerance: Levenshtein distance <= 25% of max length (min 3 chars)
  const distance = levenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);
  const threshold = Math.max(3, Math.floor(maxLen * 0.25)); // At least 3 chars allowed

  return distance <= threshold;
};

// ---------------------------------------------------------------------------
// Internal scoring types
// ---------------------------------------------------------------------------

interface RequirementCandidate {
  requirementId: string;
  ngoId: string;
  ngoName: string;
  ngoOrganization: string | null;
  ngoAddress: string | null;
  ngoCity: string | null;
  requirementCity: string;
  foodCategory: string;
  quantityNeeded: number;
  remainingQuantity: number;
  unit: string;
  urgencyLevel: string;
  activeCount: number;
  categoryHistoryCount: number;
}

// ---------------------------------------------------------------------------
// Deterministic explanation builder (fallback)
// ---------------------------------------------------------------------------

const buildDeterministicExplanation = (
  candidate: RequirementCandidate,
  factors: string[],
  score: number,
  urgencyLevel: string,
): string => {
  const ngoLabel = candidate.ngoOrganization || candidate.ngoName;
  const urgencyText =
    urgencyLevel === 'critical' || urgencyLevel === 'high'
      ? 'This is an urgent donation and'
      : 'This donation';

  const factorText =
    factors.length > 0
      ? ` Key factors: ${factors.join(', ').toLowerCase()}.`
      : '';

  return `${urgencyText} ${ngoLabel} was recommended with a match score of ${score}/100 based on their active requirement "${candidate.requirementId.slice(0, 8)}...".${factorText}`;
};

const buildDeterministicFactors = (
  candidate: RequirementCandidate,
  pickupCity: string,
  score: number,
): string[] => {
  const factors: string[] = [];

  // Proximity
  if (citiesMatch(candidate.requirementCity, pickupCity)) {
    factors.push('Same city as pickup location');
  }

  // Capacity
  if (candidate.activeCount === 0) {
    factors.push('NGO has full capacity available');
  } else if (candidate.activeCount <= 2) {
    factors.push('NGO has good capacity');
  }

  // Category
  if (candidate.categoryHistoryCount > 0) {
    factors.push(`NGO has experience with this food category (${candidate.categoryHistoryCount} past matches)`);
  }

  // Quantity fit
  const donationFitPct = Math.min(100, Math.round((candidate.remainingQuantity / candidate.quantityNeeded) * 100));
  if (donationFitPct >= 80) {
    factors.push('Donation quantity closely matches requirement');
  }

  // Score-based
  if (score >= 80) {
    factors.push('High overall compatibility');
  }

  return factors;
};

// ---------------------------------------------------------------------------
// Core matching logic — requirement-based
// ---------------------------------------------------------------------------

export const findBestMatch = async (
  donationId: string,
  foodCategory: string,
  urgencyLevel: string,
  pickupCity: string,
  donationTitle: string,
  quantity: string,
  unit: string,
  urgencyScore: number,
): Promise<MatchResult | null> => {
  try {
    // 1. Query ACTIVE requirements that are eligible for matching
    //    Eligibility: status=active, within date window, remaining>0, category matches
    console.log(`[Matching] Donation ${donationId}: searching for active requirements, category=${foodCategory}, city=${pickupCity}`);
    const reqResult = await pool.query(
      `SELECT 
        r.id as requirement_id,
        r.ngo_id,
        r.food_category,
        r.quantity_needed,
        r.remaining_quantity,
        r.unit,
        r.pickup_city as requirement_city,
        r.urgency_level as requirement_urgency,
        u.name as ngo_name,
        u.organization as ngo_organization,
        u.address as ngo_address,
        COALESCE(SUM(CASE WHEN d.id IS NOT NULL AND d.status NOT IN ('completed', 'cancelled', 'expired') THEN 1 ELSE 0 END), 0)::int as active_count,
        COALESCE(SUM(CASE WHEN d.id IS NOT NULL AND d.food_category = $1 AND d.status IN ('claimed', 'delivered', 'completed') THEN 1 ELSE 0 END), 0)::int as category_history_count
      FROM ngo_requirements r
      JOIN users u ON u.id = r.ngo_id
      LEFT JOIN donations d ON d.matched_ngo_id = u.id
      WHERE r.status = 'active'
        AND r.needed_from <= NOW()
        AND r.needed_until >= NOW()
        AND r.remaining_quantity > 0
        AND r.food_category = $1
      GROUP BY r.id, r.ngo_id, r.food_category, r.quantity_needed, r.remaining_quantity,
               r.unit, r.pickup_city, r.urgency_level,
               u.name, u.organization, u.address`,
      [foodCategory],
    );

    if (reqResult.rows.length === 0) {
      // No active eligible requirements — donation remains unmatched
      console.log(`[Matching] Donation ${donationId}: No active eligible requirements found for category '${foodCategory}'. The donation will remain in 'analyzing' status.`);
      return null;
    }
    console.log(`[Matching] Donation ${donationId}: Found ${reqResult.rows.length} eligible requirement(s)`);

    // 2. Build candidates
    const candidates: RequirementCandidate[] = reqResult.rows.map((row) => {
      const ngoAddress: string | null = row.ngo_address || null;
      const ngoCity = ngoAddress ? extractCityFromAddress(ngoAddress) : null;

      return {
        requirementId: row.requirement_id,
        ngoId: row.ngo_id,
        ngoName: row.ngo_name,
        ngoOrganization: row.ngo_organization || null,
        ngoAddress,
        ngoCity,
        requirementCity: row.requirement_city,
        foodCategory: row.food_category,
        quantityNeeded: parseFloat(row.quantity_needed),
        remainingQuantity: parseFloat(row.remaining_quantity),
        unit: row.unit,
        urgencyLevel: row.requirement_urgency,
        activeCount: row.active_count,
        categoryHistoryCount: row.category_history_count,
      };
    });

    // 3. Score each candidate (deterministic — no randomness)
    const donationQty = parseFloat(quantity) || 0;

    const scored = candidates.map((candidate) => {
      let score = 50; // base

      // --- Proximity: requirement city vs donation pickup city ---
      if (citiesMatch(candidate.requirementCity, pickupCity)) {
        score += 20;
      } else if (candidate.ngoCity && citiesMatch(candidate.ngoCity, pickupCity)) {
        score += 10; // NGO address city matches (partial proximity)
      } else if (candidate.ngoAddress) {
        score += 5; // Has address but different city
      }

      // --- NGO Capacity ---
      if (candidate.activeCount === 0) score += 20;
      else if (candidate.activeCount <= 2) score += 10;
      else if (candidate.activeCount >= 5) score -= 15;

      // --- Category experience (NGO's history with this food category) ---
      if (candidate.categoryHistoryCount > 0) score += 15;
      if (candidate.categoryHistoryCount >= 3) score += 5;

      // --- Urgency routing ---
      if (urgencyLevel === 'critical' || urgencyLevel === 'high') {
        if (candidate.activeCount === 0) score += 15;
        else if (candidate.activeCount <= 1) score += 8;
      }

      // --- Quantity fit: how well donation fills the requirement ---
      if (donationQty > 0 && candidate.remainingQuantity > 0) {
        const fillRatio = donationQty / candidate.remainingQuantity;
        if (fillRatio >= 0.8 && fillRatio <= 1.5) {
          score += 10; // Good fit
        } else if (fillRatio >= 0.3) {
          score += 5; // Partial fit
        }
      }

      score = Math.min(100, Math.max(0, score));

      const factors = buildDeterministicFactors(candidate, pickupCity, score);

      return { candidate, score, factors };
    });

    // 4. Sort by score descending, then by requirement creation (deterministic tiebreak)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tiebreak: prefer requirement with less remaining (more urgent to fill)
      return a.candidate.remainingQuantity - b.candidate.remainingQuantity;
    });
    const top = scored[0];

    if (!top || top.score < 30) {
      return null;
    }

    // 5. Try AI explanation
    let matchExplanation: string;
    let matchFactors: string[];
    let aiScore = top.score;

    try {
      const aiResult = await explainNgoMatch({
        donationTitle,
        foodCategory,
        quantity,
        unit,
        urgencyLevel,
        urgencyScore,
        ngoName: top.candidate.ngoOrganization || top.candidate.ngoName,
        ngoCity: top.candidate.requirementCity || 'unknown',
        ngoActiveDonations: top.candidate.activeCount,
        ngoPastCategoryMatches: top.candidate.categoryHistoryCount,
        pickupCity,
      });

      if (aiResult) {
        aiScore = aiResult.matchScore;
        matchExplanation = aiResult.explanation;
        matchFactors = aiResult.keyFactors;
      } else {
        matchExplanation = buildDeterministicExplanation(
          top.candidate,
          top.factors,
          top.score,
          urgencyLevel,
        );
        matchFactors = top.factors;
      }
    } catch {
      matchExplanation = buildDeterministicExplanation(
        top.candidate,
        top.factors,
        top.score,
        urgencyLevel,
      );
      matchFactors = top.factors;
    }

    const finalScore = Math.min(100, Math.max(0, aiScore));

    // 6. Insert match record (with requirement_id)
    await pool.query(
      `INSERT INTO matches (donation_id, ngo_id, match_score, match_explanation, match_factors, requirement_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        donationId,
        top.candidate.ngoId,
        finalScore,
        matchExplanation,
        JSON.stringify(matchFactors),
        top.candidate.requirementId,
      ],
    );

    return {
      ngoId: top.candidate.ngoId,
      ngoName: top.candidate.ngoOrganization || top.candidate.ngoName,
      requirementId: top.candidate.requirementId,
      matchScore: finalScore,
      matchExplanation,
      matchFactors,
    };
  } catch (error) {
    console.error('[Matching] FATAL ERROR in findBestMatch for donation %s:', donationId, error);
    console.error('[Matching] This likely means the ngo_requirements table or requirement_id column does not exist. Run the backend server to trigger schema initialization.');
    return null;
  }
};

// ---------------------------------------------------------------------------
// AI matching statistics (used by admin dashboard)
// ---------------------------------------------------------------------------

export const getAiMatchStats = async (): Promise<{
  totalMatches: number;
  avgMatchScore: number;
  successfulMatches: number;
  aiExplanationRate: number;
}> => {
  try {
    const [totalResult, avgResult, successResult, aiRateResult] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as count FROM matches'),
      pool.query('SELECT AVG(match_score)::int as avg_score FROM matches'),
      pool.query(
        `SELECT COUNT(*)::int as count FROM matches m
         JOIN donations d ON d.id = m.donation_id
         WHERE d.status IN ('claimed','pickup_scheduled','in_transit','delivered','completed')`,
      ),
      pool.query(
        `SELECT COUNT(*)::int as count FROM matches WHERE match_explanation IS NOT NULL`,
      ),
    ]);

    const total = totalResult.rows[0].count || 0;
    return {
      totalMatches: total,
      avgMatchScore: avgResult.rows[0].avg_score || 0,
      successfulMatches: successResult.rows[0].count || 0,
      aiExplanationRate: total > 0
        ? Math.round(((aiRateResult.rows[0].count || 0) / total) * 100)
        : 0,
    };
  } catch (error) {
    console.error('AI match stats error:', error);
    return { totalMatches: 0, avgMatchScore: 0, successfulMatches: 0, aiExplanationRate: 0 };
  }
};
