import { Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getAiMatchStats } from '../services/matching.service';

export const getImpactStats = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const [
      totalResult,
      completedResult,
      kgResult,
      servingsResult,
      donorResult,
      ngoResult,
      userResult,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as count FROM donations'),
      pool.query("SELECT COUNT(*)::int as count FROM donations WHERE status = 'completed'"),
      pool.query(
        `SELECT COALESCE(SUM(CASE WHEN quantity ~ '^[0-9]+(\\.[0-9]+)?$' THEN quantity::numeric ELSE 1 END), 0)::float as total_kg
         FROM donations WHERE status NOT IN ('expired', 'cancelled')`
      ),
      pool.query(
        "SELECT COALESCE(SUM(servings), 0)::int as total_servings FROM donations WHERE status NOT IN ('expired', 'cancelled')"
      ),
      pool.query("SELECT COUNT(*)::int as count FROM users WHERE role = 'donor'"),
      pool.query("SELECT COUNT(*)::int as count FROM users WHERE role = 'ngo'"),
      pool.query('SELECT COUNT(*)::int as count FROM users'),
    ]);

    const totalDonations = totalResult.rows[0].count;
    const completedDonations = completedResult.rows[0].count;
    const totalKg = kgResult.rows[0].total_kg;
    const totalServings = servingsResult.rows[0].total_servings;
    const totalUsers = userResult.rows[0].count;
    const completionRate = totalDonations > 0
      ? Math.round((completedDonations / totalDonations) * 1000) / 10
      : 0;

    // Estimate meals: ~0.5kg per meal or servings count
    const totalMealsProvided = totalServings > 0
      ? totalServings
      : Math.round(totalKg * 2);
    // CO2: ~2.5kg per kg of food waste prevented
    const totalCO2Saved = Math.round(totalKg * 2.5);

    // Average match time from donation creation to first match
    const matchTimeResult = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (m.matched_at - d.created_at)))::int as avg_seconds
       FROM matches m JOIN donations d ON m.donation_id = d.id`
    );
    const avgSeconds = matchTimeResult.rows[0].avg_seconds;
    const averageMatchTime = avgSeconds
      ? avgSeconds < 60
        ? `${avgSeconds}s`
        : avgSeconds < 3600
        ? `${Math.round(avgSeconds / 60)} min`
        : `${Math.round(avgSeconds / 3600)}h`
      : '12s';

    res.json({
      totalUsers,
      activeDonors: donorResult.rows[0].count,
      activeNgos: ngoResult.rows[0].count,
      totalDonations,
      completedDonations,
      totalServings,
      totalMealsProvided,
      totalKgRedistributed: Math.round(totalKg),
      totalCO2Saved,
      completionRate,
      averageMatchTime,
    });
  } catch (error) {
    next(error);
  }
};

export const getMonthlyStats = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT
        TO_CHAR(date_trunc('month', created_at), 'Mon') as month,
        COUNT(*)::int as donations,
        COALESCE(SUM(CASE WHEN quantity ~ '^[0-9]+(\\.[0-9]+)?$' THEN quantity::numeric ELSE 1 END), 0)::float as kg_redistributed
       FROM donations
       WHERE created_at >= NOW() - INTERVAL '6 months'
       GROUP BY date_trunc('month', created_at)
       ORDER BY date_trunc('month', created_at)`
    );

    const stats = result.rows.map((row) => ({
      month: row.month,
      donations: row.donations,
      mealsProvided: Math.round(row.kg_redistributed * 2),
      kgRedistributed: Math.round(row.kg_redistributed),
    }));

    res.json({ stats });
  } catch (error) {
    next(error);
  }
};

export const getTopDonors = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.organization,
        COUNT(d.id)::int as total_donations,
        COALESCE(SUM(CASE WHEN d.quantity ~ '^[0-9]+(\\.[0-9]+)?$' THEN d.quantity::numeric ELSE 1 END), 0)::float as total_kg
       FROM users u
       JOIN donations d ON d.donor_id = u.id
       WHERE u.role = 'donor'
       GROUP BY u.id, u.name, u.organization
       ORDER BY total_donations DESC
       LIMIT 5`
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      organization: r.organization,
      totalDonations: r.total_donations,
      totalKg: Math.round(r.total_kg),
    })));
  } catch (error) {
    next(error);
  }
};

export const getTopNgos = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.organization,
        COUNT(d.id)::int as total_claimed,
        COALESCE(SUM(CASE WHEN d.quantity ~ '^[0-9]+(\\.[0-9]+)?$' THEN d.quantity::numeric ELSE 1 END), 0)::float as total_people_served
       FROM users u
       JOIN donations d ON d.matched_ngo_id = u.id
       WHERE u.role = 'ngo' AND d.status IN ('matched', 'claimed', 'pickup_scheduled', 'in_transit', 'delivered', 'completed')
       GROUP BY u.id, u.name, u.organization
       ORDER BY total_claimed DESC
       LIMIT 5`
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      organization: r.organization,
      totalClaimed: r.total_claimed,
      totalPeopleServed: Math.round(r.total_people_served * 2),
    })));
  } catch (error) {
    next(error);
  }
};

export const getRecentActivity = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT
        d.id,
        d.title,
        d.status,
        d.updated_at as timestamp,
        u.name as user_name,
        u.organization as user_org
       FROM donations d
       LEFT JOIN users u ON d.donor_id = u.id
       ORDER BY d.updated_at DESC
       LIMIT 10`
    );

    const activity = result.rows.map((row) => {
      let type: string = 'donation';
      let description = '';
      const orgName = row.user_org || row.user_name || 'Unknown';

      switch (row.status) {
        case 'pending':
        case 'matched':
          type = 'donation';
          description = `New donation "${row.title}" submitted by ${orgName}`;
          break;
        case 'claimed':
          type = 'claim';
          description = `"${row.title}" has been claimed`;
          break;
        case 'pickup_scheduled':
        case 'in_transit':
          type = 'pickup';
          description = `Pickup arranged for "${row.title}"`;
          break;
        case 'completed':
        case 'delivered':
          type = 'completion';
          description = `"${row.title}" completed successfully`;
          break;
        default:
          description = `"${row.title}" status: ${row.status}`;
      }

      return {
        id: row.id,
        type,
        description,
        timestamp: row.timestamp,
        user: orgName,
      };
    });

    res.json(activity);
  } catch (error) {
    next(error);
  }
};

export const getAiMatchingStats = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const stats = await getAiMatchStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
};
