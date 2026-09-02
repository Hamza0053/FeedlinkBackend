import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const adminEmailSchema = z.string().email('ADMIN_EMAIL must be a valid email address');

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://postgres:password@localhost:5432/feedlink_ai'),
  PORT: z.string().default('3000'),
  JWT_SECRET: z.string().default('dev-secret-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  GEMINI_API_KEY: z.string().default(''),
  ADMIN_EMAIL: z.string().trim().toLowerCase().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  ADMIN_NAME: z.string().trim().default('Platform Admin'),
}).superRefine((data, ctx) => {
  const hasEmail = data.ADMIN_EMAIL.length > 0;
  const hasPassword = data.ADMIN_PASSWORD.length > 0;

  if (hasEmail !== hasPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ADMIN_EMAIL and ADMIN_PASSWORD must be configured together',
    });
    return;
  }

  if (hasEmail && !adminEmailSchema.safeParse(data.ADMIN_EMAIL).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ADMIN_EMAIL must be a valid email address',
    });
  }

  if (hasPassword && data.ADMIN_PASSWORD.length < 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ADMIN_PASSWORD must be at least 12 characters',
    });
  }
});

export const env = envSchema.parse(process.env);
