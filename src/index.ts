import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { initializeDatabase } from './config/database';
import { bootstrapAdmin } from './services/adminBootstrap';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configured origins
const allowedOrigins = [
  'https://feedlink-vert.vercel.app',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map((s) => s.trim()) : []),
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : []),
].filter(Boolean);

// Middleware — allow frontend Vercel app, environment origins, and localhost
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);

    // Allow configured origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow any Vercel deployment of feedlink (production or preview branches)
    if (/^https:\/\/feedlink[a-z0-9-]*\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    // Allow any localhost port in development
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api', apiRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler (must be last)
app.use(errorHandler);

const startServer = async () => {
  try {
    await initializeDatabase();
    await bootstrapAdmin();
    app.listen(PORT, () => {
      console.log(`FeedLink AI backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
