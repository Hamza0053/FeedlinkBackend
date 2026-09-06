import { Router } from 'express';
import { login, signup, getMe, forgotPassword } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { signupSchema, loginSchema, forgotPasswordSchema } from '../validators/auth.validator';

export const authRouter = Router();

authRouter.post('/signup', validate(signupSchema), signup);
authRouter.post('/login', validate(loginSchema), login);
authRouter.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
authRouter.get('/me', authenticate, getMe);
