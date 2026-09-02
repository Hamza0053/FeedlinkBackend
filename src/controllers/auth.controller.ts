import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

const generateToken = (userId: string, role: string): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign({ userId, role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });
};

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar: string | null;
  phone: string | null;
  organization: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

const sanitizeUser = (row: UserRow) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  avatar: row.avatar || null,
  phone: row.phone || null,
  organization: row.organization || null,
  address: row.address || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const signup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name, role, phone, organization, address } = req.body;

    // Check if email already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      throw new AppError('Email already registered', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, phone, organization, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, name, role, avatar, phone, organization, address, created_at, updated_at`,
      [email, passwordHash, name, role, phone || null, organization || null, address || null]
    );

    const user = sanitizeUser(result.rows[0]);
    const token = generateToken(user.id, user.role);

    res.status(201).json({ user, token });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const result = await pool.query(
      `SELECT id, email, password_hash, name, role, avatar, phone, organization, address, created_at, updated_at
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid email or password', 401);
    }

    const row = result.rows[0];

    // Compare passwords
    const validPassword = await bcrypt.compare(password, row.password_hash);
    if (!validPassword) {
      throw new AppError('Invalid email or password', 401);
    }

    const user = sanitizeUser(row);
    const token = generateToken(user.id, user.role);

    res.json({ user, token });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, role, avatar, phone, organization, address, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = sanitizeUser(result.rows[0]);
    res.json(user);
  } catch (error) {
    next(error);
  }
};
