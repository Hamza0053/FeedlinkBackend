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

statsRouter.use(authenticate, authorize('admin'));

statsRouter.get('/impact', getImpactStats);
statsRouter.get('/monthly', getMonthlyStats);
statsRouter.get('/top-donors', getTopDonors);
statsRouter.get('/top-ngos', getTopNgos);
statsRouter.get('/activity', getRecentActivity);
statsRouter.get('/ai-matching', getAiMatchingStats);
