/**
 * Admin Bootstrap Service
 *
 * Creates the initial admin account from environment variables on server startup.
 * This is idempotent: running it multiple times will not create duplicate admins.
 * If ADMIN_EMAIL or ADMIN_PASSWORD are not set, this step is skipped silently.
 */

import bcrypt from 'bcryptjs';
import { pool } from '../config/database';
import { env } from '../config/env';

export const bootstrapAdmin = async (): Promise<void> => {
  const email = env.ADMIN_EMAIL.trim();
  const password = env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('[Admin] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin bootstrap');
    return;
  }

  if (password.length < 12) {
    console.error('[Admin] ADMIN_PASSWORD must be at least 12 characters — skipping bootstrap');
    return;
  }

  try {
    // Check if admin already exists with this email
    const existing = await pool.query(
      'SELECT id, role FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.role !== 'admin') {
        console.warn('[Admin] Bootstrap email belongs to a non-admin account — not overwriting');
      } else {
        console.log('[Admin] Admin account already exists — skipping bootstrap');
      }
      return;
    }

    // Hash password and create admin
    const passwordHash = await bcrypt.hash(password, 12);
    const name = env.ADMIN_NAME.trim() || 'Platform Admin';

    await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'admin')`,
      [email, passwordHash, name]
    );

    console.log('[Admin] Admin account created successfully');
  } catch {
    console.error('[Admin] Failed to bootstrap admin account');
  }
};
