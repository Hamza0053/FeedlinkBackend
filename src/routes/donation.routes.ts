import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createDonationSchema, updateStatusSchema } from '../validators/donation.validator';
import {
  createDonation,
  getDonations,
  getDonationById,
  getAvailableDonations,
  claimDonation,
  updateDonationStatus,
  updateDonation,
  deleteDonation,
} from '../controllers/donation.controller';

export const donationRouter = Router();

// All routes require authentication
donationRouter.use(authenticate);

donationRouter.get('/available', getAvailableDonations);
donationRouter.post('/', authorize('donor'), validate(createDonationSchema), createDonation);
donationRouter.get('/', getDonations);
donationRouter.get('/:id', getDonationById);
donationRouter.put('/:id', updateDonation);
donationRouter.delete('/:id', deleteDonation);
donationRouter.post('/:id/claim', authorize('ngo'), claimDonation);
donationRouter.patch('/:id/status', validate(updateStatusSchema), updateDonationStatus);
