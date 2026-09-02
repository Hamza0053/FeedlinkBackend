import { z } from 'zod';

export const createDonationSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  foodCategory: z.enum([
    'prepared_meals',
    'fresh_produce',
    'packaged_goods',
    'bakery',
    'dairy',
    'beverages',
    'other',
  ]),
  quantity: z.string().min(1, 'Quantity is required'),
  unit: z.string().min(1, 'Unit is required'),
  servings: z.preprocess(
    (val) => {
      if (val === '' || val === undefined || val === null) return undefined;
      const n = Number(val);
      return Number.isNaN(n) ? undefined : n;
    },
    z.number().int().positive().optional(),
  ),
  expiryDate: z.string().min(1, 'Expiry date is required'),
  pickupAddress: z.string().min(5, 'Pickup address is required'),
  pickupCity: z.string().min(2, 'Pickup city is required'),
  pickupInstructions: z.string().optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum([
    'pending',
    'analyzing',
    'matched',
    'claimed',
    'pickup_scheduled',
    'in_transit',
    'delivered',
    'completed',
    'expired',
    'cancelled',
  ]),
});
