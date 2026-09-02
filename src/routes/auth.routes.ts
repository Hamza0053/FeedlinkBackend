import { Router } from 'express';
import { login, signup, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { signupSchema, loginSchema } from '../validators/auth.validator';

export const authRouter = Router();

authRouter.post('/signup', validate(signupSchema), signup);
authRouter.post('/login', validate(loginSchema), login);
authRouter.get('/me', authenticate, getMe);
