/**
 * Smart NGO Matching Service
 *
 * Scores all registered NGOs against a donation using:
 *   1. Proximity  (same city → strong bonus)
 *   2. Capacity   (fewer active donations → higher score)
 *   3. Category   (past success with this food category)
 *   4. Urgency    (high-urgency donations route to NGOs with spare capacity)
 *   5. Availability (NGO has address on file)
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
  matchScore: number;
  matchExplanation: string;
  matchFactors: string[];
}

// ---------------------------------------------------------------------------
// Internal scoring types
// ---------------------------------------------------------------------------

interface NgoCandidate {
  id: string;
  name: string;
  organization: string | null;
  address: string | null;
  city: string | null;
  activeCount: number;
  categoryHistoryCount: number;
}

// ---------------------------------------------------------------------------
// Deterministic explanation builder (fallback)
// ---------------------------------------------------------------------------

const buildDeterministicExplanation = (
  ngo: NgoCandidate,
  factors: string[],
  score: number,
  urgencyLevel: string,
): string => {
  const ngoLabel = ngo.organization || ngo.name;
  const urgencyText =
    urgencyLevel === 'critical' || urgencyLevel === 'high'
      ? 'This is an urgent donation and'
      : 'This donation';

  const factorText =
    factors.length > 0
      ? `Key factors: ${factors.join(', ').toLowerCase()}.`
      : '';

  return `${urgencyText} ${ngoLabel} was recommended with a match score of ${score}/100. ${factorText}`;
};

const buildDeterministicFactors = (
  ngo: NgoCandidate,
  pickupCity: string,
  score: number,
): string[] => {
  const factors: string[] = [];

  // Proximity
  const ngoCity = (ngo.city || '').toLowerCase().trim();
  const donCity = pickupCity.toLowerCase().trim();
  if (ngoCity && donCity && ngoCity === donCity) {
    factors.push('Same city as pickup location');
  } else if (ngo.address) {
    factors.push('Registered delivery address on file');
  }

  // Capacity
  if (ngo.activeCount === 0) {
    factors.push('Full capacity available (no active donations)');
  } else if (ngo.activeCount <= 2) {
    factors.push('Good capacity (few active donations)');
  }

  // Category
  if (ngo.categoryHistoryCount > 0) {
    factors.push(`Experience with this food category (${ngo.categoryHistoryCount} past matches)`);
  }

  // Score-based
  if (score >= 80) {
    factors.push('High overall compatibility');
  }

  return factors;
};

// ---------------------------------------------------------------------------
// Core matching logic
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
    // 1. Get all NGO users
    const ngoResult = await pool.query(
      `SELECT id, name, organization, address FROM users WHERE role = 'ngo'`,
    );

    if (ngoResult.rows.length === 0) {
      return null;
    }

    // 2. Build candidate list with pre-fetched stats
    const candidates: NgoCandidate[] = await Promise.all(
      ngoResult.rows.map(async (ngo) => {
        const [activeResult, categoryResult] = await Promise.all([
          pool.query(
            `SELECT COUNT(*)::int as active_count FROM donations
             WHERE matched_ngo_id = $1
               AND status NOT IN ('completed', 'cancelled', 'expired')`,
            [ngo.id],
          ),
          pool.query(
            `SELECT COUNT(*)::int as cat_count FROM donations
             WHERE matched_ngo_id = $1
               AND food_category = $2
               AND status IN ('claimed', 'delivered', 'completed')`,
            [ngo.id, foodCategory],
          ),
        ]);

        // Derive city from address (simple heuristic: last segment)
        const address: string | null = ngo.address || null;
        const city = address
          ? address.split(',').pop()?.trim() || null
          : null;

        return {
          id: ngo.id,
          name: ngo.name,
          organization: ngo.organization || null,
          address,
          city,
          activeCount: activeResult.rows[0].active_count,
          categoryHistoryCount: categoryResult.rows[0].cat_count,
        };
      }),
    );

    // 3. Score each candidate
    const scored = candidates.map((ngo) => {
      let score = 50; // base

      // --- Proximity ---
      const ngoCity = (ngo.city || '').toLowerCase().trim();
      const donCity = pickupCity.toLowerCase().trim();
      if (ngoCity && donCity && ngoCity === donCity) {
        score += 20;
      } else if (ngo.address) {
        score += 5;
      }

      // --- Capacity ---
      if (ngo.activeCount === 0) score += 20;
      else if (ngo.activeCount <= 2) score += 10;
      else if (ngo.activeCount >= 5) score -= 15;

      // --- Category experience ---
      if (ngo.categoryHistoryCount > 0) score += 15;
      if (ngo.categoryHistoryCount >= 3) score += 5;

      // --- Urgency routing ---
      if (urgencyLevel === 'critical' || urgencyLevel === 'high') {
        if (ngo.activeCount === 0) score += 15;
        else if (ngo.activeCount <= 1) score += 8;
      }

      // Small random factor for variety
      score += Math.floor(Math.random() * 6);

      score = Math.min(100, Math.max(0, score));

      const factors = buildDeterministicFactors(ngo, pickupCity, score);

      return { ngo, score, factors };
    });

    // 4. Sort by score descending, pick top
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];

    if (!top || top.score < 30) {
      // No NGO meets minimum threshold
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
        ngoName: top.ngo.organization || top.ngo.name,
        ngoCity: top.ngo.city || 'unknown',
        ngoActiveDonations: top.ngo.activeCount,
        ngoPastCategoryMatches: top.ngo.categoryHistoryCount,
        pickupCity,
      });

      if (aiResult) {
        aiScore = aiResult.matchScore;
        matchExplanation = aiResult.explanation;
        matchFactors = aiResult.keyFactors;
      } else {
        matchExplanation = buildDeterministicExplanation(
          top.ngo,
          top.factors,
          top.score,
          urgencyLevel,
        );
        matchFactors = top.factors;
      }
    } catch {
      matchExplanation = buildDeterministicExplanation(
        top.ngo,
        top.factors,
        top.score,
        urgencyLevel,
      );
      matchFactors = top.factors;
    }

    const finalScore = Math.min(100, Math.max(0, aiScore));

    // 6. Insert match record
    await pool.query(
      `INSERT INTO matches (donation_id, ngo_id, match_score, match_explanation, match_factors)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        donationId,
        top.ngo.id,
        finalScore,
        matchExplanation,
        JSON.stringify(matchFactors),
      ],
    );

    return {
      ngoId: top.ngo.id,
      ngoName: top.ngo.organization || top.ngo.name,
      matchScore: finalScore,
      matchExplanation,
      matchFactors,
    };
  } catch (error) {
    console.error('Matching service error:', error);
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
