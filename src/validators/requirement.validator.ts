import { z } from 'zod';

const foodCategories = [
  'prepared_meals',
  'fresh_produce',
  'packaged_goods',
  'bakery',
  'dairy',
  'beverages',
  'other',
] as const;

const urgencyLevels = ['low', 'medium', 'high', 'critical'] as const;

export const createRequirementSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(500),
  description: z.string().max(5000).optional().or(z.literal('')),
  foodCategory: z.enum(foodCategories, {
    errorMap: () => ({ message: 'Invalid food category' }),
  }),
  quantityNeeded: z
    .union([z.string(), z.number()])
    .transform((val) => {
      const n = typeof val === 'string' ? parseFloat(val) : val;
      return n;
    })
    .pipe(z.number().positive('Quantity must be greater than 0')),
  unit: z.string().min(1, 'Unit is required').max(50),
  neededFrom: z.string().min(1, 'Start date is required'),
  neededUntil: z.string().min(1, 'End date is required'),
  pickupCity: z.string().min(2, 'Pickup city is required').max(255),
  urgencyLevel: z.enum(urgencyLevels).optional().default('medium'),
}).refine(
  (data) => {
    const from = new Date(data.neededFrom);
    const until = new Date(data.neededUntil);
    return until > from;
  },
  {
    message: 'End date must be after start date',
    path: ['neededUntil'],
  },
);

export const updateRequirementSchema = z.object({
  title: z.string().min(3).max(500).optional(),
  description: z.string().max(5000).optional().or(z.literal('')),
  foodCategory: z.enum(foodCategories).optional(),
  quantityNeeded: z
    .union([z.string(), z.number()])
    .transform((val) => {
      const n = typeof val === 'string' ? parseFloat(val) : val;
      return n;
    })
    .pipe(z.number().positive('Quantity must be greater than 0'))
    .optional(),
  unit: z.string().min(1).max(50).optional(),
  neededFrom: z.string().min(1).optional(),
  neededUntil: z.string().min(1).optional(),
  pickupCity: z.string().min(2).max(255).optional(),
  urgencyLevel: z.enum(urgencyLevels).optional(),
}).refine(
  (data) => {
    if (data.neededFrom && data.neededUntil) {
      return new Date(data.neededUntil) > new Date(data.neededFrom);
    }
    return true;
  },
  {
    message: 'End date must be after start date',
    path: ['neededUntil'],
  },
);

export const cancelRequirementSchema = z.object({
  status: z.literal('cancelled'),
});
