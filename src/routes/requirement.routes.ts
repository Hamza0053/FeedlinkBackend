import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createRequirementSchema,
  updateRequirementSchema,
} from '../validators/requirement.validator';
import {
  createRequirement,
  getMyRequirements,
  getActiveRequirements,
  getRequirementById,
  updateRequirement,
  cancelRequirement,
  expireOldRequirements,
} from '../controllers/requirement.controller';

export const requirementRouter = Router();

// All routes require authentication
requirementRouter.use(authenticate);

// NGO creates a requirement
requirementRouter.post('/', authorize('ngo'), validate(createRequirementSchema), createRequirement);

// NGO gets own requirements
requirementRouter.get('/my', authorize('ngo'), getMyRequirements);

// Get all active requirements (for matching / browsing)
requirementRouter.get('/active', getActiveRequirements);

// Expire old requirements (admin only)
requirementRouter.post('/expire', authorize('admin'), expireOldRequirements);

// Get single requirement
requirementRouter.get('/:id', getRequirementById);

// Update requirement (NGO own only)
requirementRouter.patch('/:id', authorize('ngo'), validate(updateRequirementSchema), updateRequirement);

// Cancel requirement (NGO own only)
requirementRouter.delete('/:id', authorize('ngo'), cancelRequirement);
