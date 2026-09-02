import { Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AuthRequest } from '../middleware/auth';

export const getUsers = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, role, avatar, phone, organization, address, created_at, updated_at
       FROM users ORDER BY created_at DESC`
    );

    res.json({
      users: result.rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        avatar: r.avatar,
        phone: r.phone,
        organization: r.organization,
        address: r.address,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, email, name, role, avatar, phone, organization, address, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const r = result.rows[0];
    res.json({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      avatar: r.avatar,
      phone: r.phone,
      organization: r.organization,
      address: r.address,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  } catch (error) {
    next(error);
  }
};
