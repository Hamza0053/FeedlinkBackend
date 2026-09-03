import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const testConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('Database connected successfully');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
};

export const initializeDatabase = async (): Promise<void> => {
  const connected = await testConnection();
  if (!connected) {
    throw new Error('Cannot initialize database: connection failed');
  }

  try {
    const possiblePaths = [
      path.join(__dirname, '..', 'db', 'schema.sql'),
      path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql'),
      path.join(process.cwd(), 'src', 'db', 'schema.sql'),
      path.join(process.cwd(), 'dist', 'db', 'schema.sql'),
    ];
    const schemaPath = possiblePaths.find((p) => fs.existsSync(p));
    if (!schemaPath) {
      throw new Error(`Database schema file not found in any expected location: ${possiblePaths.join(', ')}`);
    }
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Database schema initialization failed:', error);
    throw error;
  }
};
