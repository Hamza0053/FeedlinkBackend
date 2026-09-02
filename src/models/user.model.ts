// User model - ready for database integration
export interface UserModel {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: 'donor' | 'ngo' | 'admin';
  avatar?: string;
  phone?: string;
  organization?: string;
  address?: string;
  created_at: Date;
  updated_at: Date;
}

// Database queries will be added here when connecting to PostgreSQL
// Example:
// export const findByEmail = async (email: string) => {
//   const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
//   return result.rows[0];
// };
