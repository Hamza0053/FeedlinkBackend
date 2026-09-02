import { Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { findBestMatch } from '../services/matching.service';
import { createNotification } from '../services/notification.service';
import { analyzeFoodDonation, isAiAvailable, AiUrgencyResult } from '../services/gemini.service';

// ---------------------------------------------------------------------------
// Deterministic urgency computation (always available, used as fallback)
// ---------------------------------------------------------------------------

const computeDeterministicUrgency = (
  expiryDate: string,
): { level: string; score: number } => {
  const hoursUntilExpiry =
    (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60);

  if (hoursUntilExpiry <= 0) return { level: 'critical', score: 10 };
  if (hoursUntilExpiry < 6) return { level: 'critical', score: 9 };
  if (hoursUntilExpiry < 24) return { level: 'high', score: 8 };
  if (hoursUntilExpiry < 72) return { level: 'medium', score: 5 };
  return { level: 'low', score: 2 };
};

// ---------------------------------------------------------------------------
// Deterministic AI analysis builder (fallback when Gemini is unavailable)
// ---------------------------------------------------------------------------

const buildDeterministicAnalysis = (
  foodCategory: string,
  expiryDate: string,
  urgency: { level: string; score: number },
) => {
  const hoursUntilExpiry = Math.max(
    1,
    Math.round((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60)),
  );

  const categoryAdvice: Record<string, string> = {
    prepared_meals: 'Best for immediate distribution to shelters and soup kitchens',
    fresh_produce: 'Suitable for community kitchens and cooking programs',
    packaged_goods: 'Can be stored and distributed through food pantries',
    bakery: 'Ideal for breakfast programs and community centers',
    dairy: 'Requires refrigerated distribution to facilities with cold storage',
    beverages: 'Good for breakfast programs and school meal services',
    other: 'Evaluate on a case-by-case basis',
  };

  return {
    urgencyScore: urgency.score,
    urgencyLevel: urgency.level,
    shelfLifeEstimate: `${hoursUntilExpiry} hours remaining`,
    recommendedDistribution:
      categoryAdvice[foodCategory] || 'Suitable for general distribution',
    storageRecommendations: [
      'Keep refrigerated if applicable',
      'Check condition before distribution',
      'Follow food safety guidelines',
    ],
    analysisTimestamp: new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Gemini-powered AI analysis with deterministic fallback
// ---------------------------------------------------------------------------

interface FullAiAnalysis {
  urgencyScore: number;       // 1-10 (stored in DB)
  urgencyScorePercent: number; // 0-100 (displayed)
  urgencyLevel: string;
  shelfLifeEstimate: string;
  recommendedDistribution: string;
  recommendedAction: string;
  explanation: string;
  storageRecommendations: string[];
  analysisTimestamp: string;
  source: 'gemini' | 'deterministic';
}

const runAiAnalysis = async (
  foodCategory: string,
  expiryDate: string,
  input: {
    title: string;
    description: string;
    quantity: string;
    unit: string;
    servings: number | null;
    pickupCity: string;
  },
): Promise<FullAiAnalysis> => {
  const deterministic = computeDeterministicUrgency(expiryDate);

  // Try Gemini
  let aiResult: AiUrgencyResult | null = null;
  try {
    aiResult = await analyzeFoodDonation({
      title: input.title,
      description: input.description,
      foodCategory,
      quantity: input.quantity,
      unit: input.unit,
      servings: input.servings,
      expiryDate,
      pickupCity: input.pickupCity,
    });
  } catch (error) {
    console.error('[AI] Analysis failed, falling back to deterministic:', error);
  }

  if (aiResult) {
    // Gemini succeeded — map its output to our analysis shape
    const score10 = Math.max(1, Math.min(10, Math.round(aiResult.urgencyScore / 10)));
    return {
      urgencyScore: score10,
      urgencyScorePercent: aiResult.urgencyScore,
      urgencyLevel: aiResult.urgencyLevel.toLowerCase(),
      shelfLifeEstimate: aiResult.shelfLifeEstimate,
      recommendedDistribution:
        buildDeterministicAnalysis(foodCategory, expiryDate, deterministic)
          .recommendedDistribution,
      recommendedAction: aiResult.recommendedAction,
      explanation: aiResult.explanation,
      storageRecommendations: aiResult.storageRecommendations,
      analysisTimestamp: new Date().toISOString(),
      source: 'gemini',
    };
  }

  // Deterministic fallback
  const det = buildDeterministicAnalysis(foodCategory, expiryDate, deterministic);
  return {
    urgencyScore: deterministic.score,
    urgencyScorePercent: Math.round((deterministic.score / 10) * 100),
    urgencyLevel: deterministic.level,
    shelfLifeEstimate: det.shelfLifeEstimate,
    recommendedDistribution: det.recommendedDistribution,
    recommendedAction: 'Distribute to a nearby NGO as soon as possible.',
    explanation: `Urgency assessed based on expiry date (${det.shelfLifeEstimate}) and food category (${foodCategory}). AI analysis was not available.`,
    storageRecommendations: det.storageRecommendations,
    analysisTimestamp: new Date().toISOString(),
    source: 'deterministic',
  };
};

// ---------------------------------------------------------------------------
// DB row → camelCase mapper
// ---------------------------------------------------------------------------

const mapDonation = (row: Record<string, unknown>) => ({
  id: row.id,
  donorId: row.donor_id,
  donorName: row.donor_name || row.donor_name_fallback,
  title: row.title,
  description: row.description,
  foodCategory: row.food_category,
  quantity: row.quantity,
  unit: row.unit,
  servings: row.servings || null,
  expiryDate: row.expiry_date,
  pickupAddress: row.pickup_address,
  pickupCity: row.pickup_city,
  pickupInstructions: row.pickup_instructions,
  images: row.images || [],
  status: row.status,
  urgencyLevel: row.urgency_level,
  urgencyScore: row.urgency_score,
  aiAnalysis: row.ai_analysis,
  aiExplanation: row.ai_explanation || null,
  aiSource: row.ai_source || 'deterministic',
  matchExplanation: row.match_explanation || null,
  matchScore: row.match_score || null,
  matchedNgoId: row.matched_ngo_id,
  matchedNgoName: row.matched_ngo_name || null,
  claimedAt: row.claimed_at,
  pickupScheduledAt: row.pickup_scheduled_at,
  deliveredAt: row.delivered_at,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const DONATION_SELECT = `
  d.id,
  d.donor_id,
  COALESCE(donor_org.name, '') as donor_name_fallback,
  donor_org.organization as donor_name,
  d.title,
  d.description,
  d.food_category,
  d.quantity,
  d.unit,
  d.servings,
  d.expiry_date,
  d.pickup_address,
  d.pickup_city,
  d.pickup_instructions,
  d.images,
  d.status,
  d.urgency_level,
  d.urgency_score,
  d.ai_analysis,
  d.ai_explanation,
  d.ai_source,
  d.match_explanation,
  d.match_score,
  d.matched_ngo_id,
  ngo_org.organization as matched_ngo_name,
  d.claimed_at,
  d.pickup_scheduled_at,
  d.delivered_at,
  d.completed_at,
  d.created_at,
  d.updated_at
`;

const DONATION_JOINS = `
  LEFT JOIN users donor_org ON d.donor_id = donor_org.id
  LEFT JOIN users ngo_org ON d.matched_ngo_id = ngo_org.id
`;

// ---------------------------------------------------------------------------
// CREATE DONATION — full AI pipeline
// ---------------------------------------------------------------------------

export const createDonation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      title,
      description,
      foodCategory,
      quantity,
      unit,
      servings,
      expiryDate,
      pickupAddress,
      pickupCity,
      pickupInstructions,
    } = req.body;

    // 1. Insert donation as 'pending'
    const parsedServings = servings ? parseInt(servings, 10) || null : null;
    const insertResult = await pool.query(
      `INSERT INTO donations
        (donor_id, title, description, food_category, quantity, unit, servings,
         expiry_date, pickup_address, pickup_city, pickup_instructions,
         status, urgency_level, urgency_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 'medium', 5)
       RETURNING id`,
      [
        req.userId,
        title,
        description,
        foodCategory,
        quantity,
        unit,
        parsedServings,
        expiryDate,
        pickupAddress,
        pickupCity,
        pickupInstructions || null,
      ],
    );

    const donationId = insertResult.rows[0].id;

    // 2. Run AI analysis (Gemini or deterministic)
    const analysis = await runAiAnalysis(foodCategory, expiryDate, {
      title,
      description: description || '',
      quantity,
      unit,
      servings: parsedServings,
      pickupCity,
    });

    // 3. Update donation with AI results
    const aiAnalysisJson = {
      urgencyScore: analysis.urgencyScore,
      urgencyScorePercent: analysis.urgencyScorePercent,
      urgencyLevel: analysis.urgencyLevel,
      shelfLifeEstimate: analysis.shelfLifeEstimate,
      recommendedDistribution: analysis.recommendedDistribution,
      recommendedAction: analysis.recommendedAction,
      explanation: analysis.explanation,
      storageRecommendations: analysis.storageRecommendations,
      analysisTimestamp: analysis.analysisTimestamp,
    };

    await pool.query(
      `UPDATE donations SET
         urgency_level = $1,
         urgency_score = $2,
         ai_analysis = $3,
         ai_explanation = $4,
         ai_source = $5,
         status = 'analyzing',
         updated_at = NOW()
       WHERE id = $6`,
      [
        analysis.urgencyLevel,
        analysis.urgencyScore,
        JSON.stringify(aiAnalysisJson),
        analysis.explanation,
        analysis.source,
        donationId,
      ],
    );

    // 4. Find best NGO match (with AI explanation)
    const match = await findBestMatch(
      donationId,
      foodCategory,
      analysis.urgencyLevel,
      pickupCity,
      title,
      quantity,
      unit,
      analysis.urgencyScorePercent,
    );

    if (match) {
      await pool.query(
        `UPDATE donations SET
           status = 'matched',
           matched_ngo_id = $1,
           match_explanation = $2,
           match_score = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [match.ngoId, match.matchExplanation, match.matchScore, donationId],
      );

      // Notify the matched NGO
      const aiTag = isAiAvailable() ? 'AI recommended' : 'System matched';
      await createNotification(
        match.ngoId,
        'donation_matched',
        'New Donation Matched!',
        `"${title}" has been matched with your organisation (${aiTag}, score ${match.matchScore}/100). Review and claim it.`,
        `/donations/${donationId}`,
      );
    }

    // 5. Notify donor
    const matchText = match
      ? ` and AI-matched with ${match.ngoName} (score ${match.matchScore}/100)`
      : '';
    await createNotification(
      req.userId!,
      'donation_created',
      'Donation Created & Analyzed',
      `Your donation "${title}" has been submitted${matchText}. Urgency: ${analysis.urgencyLevel.toUpperCase()}.`,
      `/donations/${donationId}`,
    );

    // 6. Return full donation
    const fullResult = await pool.query(
      `SELECT ${DONATION_SELECT} FROM donations d ${DONATION_JOINS} WHERE d.id = $1`,
      [donationId],
    );

    res.status(201).json(mapDonation(fullResult.rows[0]));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// READ endpoints (unchanged logic, updated field mapping)
// ---------------------------------------------------------------------------

export const getDonations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status } = req.query;
    const userRole = req.userRole;
    const userId = req.userId;

    let whereClause = '';
    const params: (string | undefined)[] = [];
    let paramIdx = 1;

    if (userRole === 'donor') {
      whereClause = `WHERE d.donor_id = $${paramIdx}`;
      params.push(userId);
      paramIdx++;
    } else if (userRole === 'ngo') {
      whereClause = `WHERE (
        d.status IN ('pending', 'matched', 'analyzing') AND (d.matched_ngo_id IS NULL OR d.matched_ngo_id = $${paramIdx})
      ) OR d.matched_ngo_id = $${paramIdx}`;
      params.push(userId);
      paramIdx++;
    }

    if (status && typeof status === 'string') {
      const statuses = status.split(',');
      const placeholders = statuses.map((_, i) => `$${paramIdx + i}`).join(', ');
      whereClause += whereClause
        ? ` AND d.status IN (${placeholders})`
        : `WHERE d.status IN (${placeholders})`;
      params.push(...statuses);
      paramIdx += statuses.length;
    }

    const query = `SELECT ${DONATION_SELECT} FROM donations d ${DONATION_JOINS} ${whereClause} ORDER BY d.created_at DESC`;
    const result = await pool.query(query, params);

    res.json({ donations: result.rows.map(mapDonation) });
  } catch (error) {
    next(error);
  }
};

export const getAvailableDonations = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT ${DONATION_SELECT} FROM donations d ${DONATION_JOINS}
       WHERE d.status IN ('pending', 'matched', 'analyzing')
       ORDER BY d.urgency_score DESC, d.created_at DESC`,
    );

    res.json({ donations: result.rows.map(mapDonation) });
  } catch (error) {
    next(error);
  }
};

export const getDonationById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT ${DONATION_SELECT} FROM donations d ${DONATION_JOINS} WHERE d.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new AppError('Donation not found', 404);
    }

    res.json(mapDonation(result.rows[0]));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// CLAIM
// ---------------------------------------------------------------------------

export const claimDonation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const ngoId = req.userId;

    const donationResult = await pool.query(
      'SELECT * FROM donations WHERE id = $1',
      [id],
    );

    if (donationResult.rows.length === 0) {
      throw new AppError('Donation not found', 404);
    }

    const donation = donationResult.rows[0];

    if (!['pending', 'matched', 'analyzing'].includes(donation.status)) {
      throw new AppError(
        `Donation cannot be claimed (status: ${donation.status})`,
        400,
      );
    }

    await pool.query(
      `UPDATE donations SET status = 'claimed', matched_ngo_id = $1, claimed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [ngoId, id],
    );

    if (!donation.matched_ngo_id) {
      await pool.query(
        `INSERT INTO matches (donation_id, ngo_id, match_score, match_explanation)
         VALUES ($1, $2, 100, 'Manually claimed by NGO')`,
        [id, ngoId],
      );
    }

    await createNotification(
      donation.donor_id,
      'donation_claimed',
      'Donation Claimed!',
      `Your donation "${donation.title}" has been claimed by an NGO.`,
      `/donations/${id}`,
    );

    const fullResult = await pool.query(
      `SELECT ${DONATION_SELECT} FROM donations d ${DONATION_JOINS} WHERE d.id = $1`,
      [id],
    );

    res.json(mapDonation(fullResult.rows[0]));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// STATUS TRANSITIONS
// ---------------------------------------------------------------------------

export const updateDonationStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const current = await pool.query('SELECT * FROM donations WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      throw new AppError('Donation not found', 404);
    }

    const donation = current.rows[0];

    const updates: string[] = ['status = $1', 'updated_at = NOW()'];
    const params: (string | null)[] = [status];
    let paramIdx = 2;

    switch (status) {
      case 'pickup_scheduled':
        updates.push(`pickup_scheduled_at = $${paramIdx}`);
        params.push(new Date().toISOString());
        paramIdx++;
        break;
      case 'delivered':
        updates.push(`delivered_at = $${paramIdx}`);
        params.push(new Date().toISOString());
        paramIdx++;
        break;
      case 'completed':
        updates.push(`completed_at = $${paramIdx}`);
        params.push(new Date().toISOString());
        paramIdx++;
        break;
    }

    params.push(id);
    await pool.query(
      `UPDATE donations SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      params,
    );

    const notifyUserId =
      status === 'completed' || status === 'pickup_scheduled'
        ? donation.donor_id
        : donation.matched_ngo_id;

    if (notifyUserId) {
      const notificationMessages: Record<
        string,
        {
          title: string;
          message: string;
          type:
            | 'donation_claimed'
            | 'pickup_scheduled'
            | 'donation_completed'
            | 'donation_matched';
        }
      > = {
        pickup_scheduled: {
          type: 'pickup_scheduled',
          title: 'Pickup Scheduled',
          message: `Pickup has been scheduled for "${donation.title}".`,
        },
        in_transit: {
          type: 'donation_matched',
          title: 'Donation In Transit',
          message: `"${donation.title}" is now in transit.`,
        },
        delivered: {
          type: 'donation_matched',
          title: 'Donation Delivered',
          message: `"${donation.title}" has been delivered.`,
        },
        completed: {
          type: 'donation_completed',
          title: 'Donation Completed!',
          message: `"${donation.title}" has been completed. Thank you for your contribution!`,
        },
        cancelled: {
          type: 'donation_matched',
          title: 'Donation Cancelled',
          message: `"${donation.title}" has been cancelled.`,
        },
      };

      const notif = notificationMessages[status];
      if (notif) {
        await createNotification(
          notifyUserId,
          notif.type,
          notif.title,
          notif.message,
          `/donations/${id}`,
        );
      }
    }

    const fullResult = await pool.query(
      `SELECT ${DONATION_SELECT} FROM donations d ${DONATION_JOINS} WHERE d.id = $1`,
      [id],
    );

    res.json(mapDonation(fullResult.rows[0]));
  } catch (error) {
    next(error);
  }
};
