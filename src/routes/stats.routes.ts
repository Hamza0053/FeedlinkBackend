import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  getImpactStats,
  getMonthlyStats,
  getTopDonors,
  getTopNgos,
  getRecentActivity,
  getAiMatchingStats,
} from '../controllers/stats.controller';

export const statsRouter = Router();

// Platform impact stats are accessible to all authenticated and public visitors
statsRouter.get('/impact', getImpactStats);
statsRouter.get('/monthly', getMonthlyStats);
statsRouter.get('/top-donors', getTopDonors);
statsRouter.get('/top-ngos', getTopNgos);
statsRouter.get('/activity', getRecentActivity);
statsRouter.get('/ai-matching', getAiMatchingStats);
