import { Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { mapRequirement } from '../models/requirement.model';

// ---------------------------------------------------------------------------
// CREATE requirement
// ---------------------------------------------------------------------------

export const createRequirement = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const ngoId = req.userId;
    const {
      title,
      description,
      foodCategory,
      quantityNeeded,
      unit,
      neededFrom,
      neededUntil,
      pickupCity,
      urgencyLevel,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO ngo_requirements
        (ngo_id, title, description, food_category, quantity_needed, unit,
         remaining_quantity, needed_from, needed_until, pickup_city, urgency_level, status)
       VALUES ($1, $2, $3, $4, $5, $6, $5, $7, $8, $9, $10, 'active')
       RETURNING *`,
      [
        ngoId,
        title,
        description || null,
        foodCategory,
        quantityNeeded,
        unit,
        neededFrom,
        neededUntil,
        pickupCity,
        urgencyLevel || 'medium',
      ],
    );

    res.status(201).json(mapRequirement(result.rows[0]));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// GET NGO's own requirements
// ---------------------------------------------------------------------------

export const getMyRequirements = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const ngoId = req.userId;
    const { status } = req.query;

    let query = `SELECT * FROM ngo_requirements WHERE ngo_id = $1`;
    const params: (string | undefined)[] = [ngoId];

    if (status && typeof status === 'string') {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ requirements: result.rows.map(mapRequirement) });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// GET active requirements (public for matching, or admin view)
// ---------------------------------------------------------------------------

export const getActiveRequirements = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name as ngo_name, u.organization as ngo_organization
       FROM ngo_requirements r
       JOIN users u ON u.id = r.ngo_id
       WHERE r.status = 'active'
         AND r.needed_from <= NOW()
         AND r.needed_until >= NOW()
         AND r.remaining_quantity > 0
       ORDER BY r.urgency_level DESC, r.created_at DESC`,
    );

    res.json({ requirements: result.rows.map(mapRequirement) });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// GET single requirement
// ---------------------------------------------------------------------------

export const getRequirementById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT r.*, u.name as ngo_name, u.organization as ngo_organization
       FROM ngo_requirements r
       JOIN users u ON u.id = r.ngo_id
       WHERE r.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new AppError('Requirement not found', 404);
    }

    res.json(mapRequirement(result.rows[0]));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// UPDATE requirement (only own, only if active)
// ---------------------------------------------------------------------------

export const updateRequirement = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const ngoId = req.userId;
    const userRole = req.userRole;

    const existing = await pool.query(
      'SELECT * FROM ngo_requirements WHERE id = $1',
      [id],
    );

    if (existing.rows.length === 0) {
      throw new AppError('Requirement not found', 404);
    }

    const requirement = existing.rows[0];

    // Ownership check (admin can edit any)
    if (requirement.ngo_id !== ngoId && userRole !== 'admin') {
      throw new AppError('You can only edit your own requirements', 403);
    }

    // Can only edit active requirements
    if (requirement.status !== 'active') {
      throw new AppError(
        `Cannot edit a requirement with status: ${requirement.status}`,
        400,
      );
    }

    const {
      title,
      description,
      foodCategory,
      quantityNeeded,
      unit,
      neededFrom,
      neededUntil,
      pickupCity,
      urgencyLevel,
    } = req.body;

    // If quantity is being changed, adjust remaining_quantity proportionally
    let newRemaining = requirement.remaining_quantity;
    if (quantityNeeded !== undefined) {
      const oldQuantity = parseFloat(requirement.quantity_needed);
      const fulfilled = oldQuantity - parseFloat(requirement.remaining_quantity);
      newRemaining = Math.max(0, parseFloat(String(quantityNeeded)) - fulfilled);
    }

    await pool.query(
      `UPDATE ngo_requirements SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         food_category = COALESCE($3, food_category),
         quantity_needed = COALESCE($4, quantity_needed),
         remaining_quantity = $5,
         unit = COALESCE($6, unit),
         needed_from = COALESCE($7, needed_from),
         needed_until = COALESCE($8, needed_until),
         pickup_city = COALESCE($9, pickup_city),
         urgency_level = COALESCE($10, urgency_level),
         updated_at = NOW()
       WHERE id = $11`,
      [
        title || null,
        description !== undefined ? description : null,
        foodCategory || null,
        quantityNeeded || null,
        newRemaining,
        unit || null,
        neededFrom || null,
        neededUntil || null,
        pickupCity || null,
        urgencyLevel || null,
        id,
      ],
    );

    const updated = await pool.query('SELECT * FROM ngo_requirements WHERE id = $1', [id]);
    res.json(mapRequirement(updated.rows[0]));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// CANCEL requirement (soft-delete)
// ---------------------------------------------------------------------------

export const cancelRequirement = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const ngoId = req.userId;
    const userRole = req.userRole;

    const existing = await pool.query(
      'SELECT * FROM ngo_requirements WHERE id = $1',
      [id],
    );

    if (existing.rows.length === 0) {
      throw new AppError('Requirement not found', 404);
    }

    const requirement = existing.rows[0];

    if (requirement.ngo_id !== ngoId && userRole !== 'admin') {
      throw new AppError('You can only cancel your own requirements', 403);
    }

    if (requirement.status !== 'active') {
      throw new AppError(
        `Cannot cancel a requirement with status: ${requirement.status}`,
        400,
      );
    }

    await pool.query(
      `UPDATE ngo_requirements SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id],
    );

    const updated = await pool.query('SELECT * FROM ngo_requirements WHERE id = $1', [id]);
    res.json(mapRequirement(updated.rows[0]));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// EXPIRE old requirements (admin/system endpoint)
// ---------------------------------------------------------------------------

export const expireOldRequirements = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await pool.query(
      `UPDATE ngo_requirements
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active' AND needed_until < NOW()
       RETURNING id`,
    );

    res.json({
      expired: result.rowCount || 0,
      message: `${result.rowCount || 0} requirement(s) expired`,
    });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// FULFILL / partially fulfill a requirement (called internally by matching)
// ---------------------------------------------------------------------------

export const fulfillRequirementQuantity = async (
  requirementId: string,
  quantityToConsume: number,
): Promise<{ remaining: number; status: string }> => {
  // Use a transaction to prevent race conditions
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row for update
    const locked = await client.query(
      `SELECT * FROM ngo_requirements WHERE id = $1 FOR UPDATE`,
      [requirementId],
    );

    if (locked.rows.length === 0) {
      throw new Error('Requirement not found');
    }

    const req = locked.rows[0];
    const currentRemaining = parseFloat(req.remaining_quantity);
    const newRemaining = Math.max(0, currentRemaining - quantityToConsume);
    const newStatus = newRemaining <= 0 ? 'fulfilled' : 'active';
    const fulfilledAt = newRemaining <= 0 ? new Date().toISOString() : null;

    await client.query(
      `UPDATE ngo_requirements
       SET remaining_quantity = $1,
           status = $2,
           fulfilled_at = COALESCE($3, fulfilled_at),
           updated_at = NOW()
       WHERE id = $4`,
      [newRemaining, newStatus, fulfilledAt, requirementId],
    );

    await client.query('COMMIT');
    return { remaining: newRemaining, status: newStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
