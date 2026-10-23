/**
 * Database Clean & Admin Re-Bootstrap Script
 * 
 * Safely removes all test/demo data (donations, matches, requirements,
 * notifications, password resets, and non-admin users) inside an atomic
 * transaction, preserving schema, tables, indexes, and referential integrity.
 * 
 * Ensures the platform admin specified in environment variables (.env) is active.
 */

import bcrypt from 'bcryptjs';
import { pool } from '../config/database';
import { env } from '../config/env';

interface TableCounts {
  notifications: number;
  password_resets: number;
  matches: number;
  donations: number;
  ngo_requirements: number;
  impact_snapshots: number;
  users: number;
}

async function getCounts(client: any): Promise<TableCounts> {
  const [notifs, resets, matches, donations, reqs, impact, users] = await Promise.all([
    client.query('SELECT count(*)::int as cnt FROM notifications'),
    client.query('SELECT count(*)::int as cnt FROM password_resets'),
    client.query('SELECT count(*)::int as cnt FROM matches'),
    client.query('SELECT count(*)::int as cnt FROM donations'),
    client.query('SELECT count(*)::int as cnt FROM ngo_requirements'),
    client.query('SELECT count(*)::int as cnt FROM impact_snapshots'),
    client.query('SELECT count(*)::int as cnt FROM users'),
  ]);

  return {
    notifications: notifs.rows[0].cnt,
    password_resets: resets.rows[0].cnt,
    matches: matches.rows[0].cnt,
    donations: donations.rows[0].cnt,
    ngo_requirements: reqs.rows[0].cnt,
    impact_snapshots: impact.rows[0].cnt,
    users: users.rows[0].cnt,
  };
}

export async function cleanDatabase() {
  const adminEmail = env.ADMIN_EMAIL.trim().toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD;
  const adminName = env.ADMIN_NAME.trim() || 'Platform Admin';

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be configured in .env before running cleanup.');
  }

  const client = await pool.connect();

  try {
    console.log('====================================================');
    console.log('       FEEDLINK AI - DATABASE CLEANUP RUNNER        ');
    console.log('====================================================\n');

    console.log(`Target Database: ${client.database}`);
    console.log(`Preserving / Bootstrapping Admin Account: ${adminEmail}\n`);

    const before = await getCounts(client);
    console.log('State BEFORE Cleanup:');
    console.table(before);

    console.log('Beginning atomic transaction...');
    await client.query('BEGIN');

    // 1. Delete notifications
    const delNotifs = await client.query('DELETE FROM notifications');
    console.log(` - Deleted ${delNotifs.rowCount} notifications`);

    // 2. Delete password reset tokens
    const delResets = await client.query('DELETE FROM password_resets');
    console.log(` - Deleted ${delResets.rowCount} password resets`);

    // 3. Delete AI matches (references donations, users, ngo_requirements)
    const delMatches = await client.query('DELETE FROM matches');
    console.log(` - Deleted ${delMatches.rowCount} matches`);

    // 4. Delete donations (references users for donor_id and matched_ngo_id)
    const delDonations = await client.query('DELETE FROM donations');
    console.log(` - Deleted ${delDonations.rowCount} donations`);

    // 5. Delete NGO requirements
    const delReqs = await client.query('DELETE FROM ngo_requirements');
    console.log(` - Deleted ${delReqs.rowCount} NGO requirements`);

    // 6. Delete impact snapshots
    const delImpact = await client.query('DELETE FROM impact_snapshots');
    console.log(` - Deleted ${delImpact.rowCount} impact snapshots`);

    // 7. Delete all users EXCEPT the configured admin email
    const delUsers = await client.query('DELETE FROM users WHERE LOWER(email) != LOWER($1)', [adminEmail]);
    console.log(` - Deleted ${delUsers.rowCount} non-admin users`);

    // 8. Ensure admin account exists with proper hashed credentials
    const existingAdmin = await client.query('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1)', [adminEmail]);
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    if (existingAdmin.rows.length === 0) {
      await client.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, 'admin')`,
        [adminEmail, passwordHash, adminName]
      );
      console.log(` - Inserted fresh admin account (${adminEmail})`);
    } else {
      await client.query(
        `UPDATE users
         SET password_hash = $1, name = $2, role = 'admin', updated_at = NOW()
         WHERE LOWER(email) = LOWER($3)`,
        [passwordHash, adminName, adminEmail]
      );
      console.log(` - Updated credentials for existing admin account (${adminEmail})`);
    }

    console.log('\nCommitting transaction...');
    await client.query('COMMIT');
    console.log('Transaction committed successfully.\n');

    const after = await getCounts(client);
    console.log('State AFTER Cleanup:');
    console.table(after);

    console.log('====================================================');
    console.log('      DATABASE CLEANUP COMPLETED SUCCESSFULLY       ');
    console.log('====================================================');
  } catch (err) {
    console.error('\n[FATAL] Error occurred during cleanup! Rolling back transaction...');
    await client.query('ROLLBACK');
    console.error('Transaction rolled back. Database remains untouched.');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Execute if run directly via tsx
if (require.main === module || process.argv[1]?.includes('clean-database')) {
  cleanDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
