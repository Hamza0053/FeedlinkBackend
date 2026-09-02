import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getUsers, getUserById } from '../controllers/user.controller';

export const userRouter = Router();

userRouter.use(authenticate);

userRouter.get('/', authorize('admin'), getUsers);
userRouter.get('/:id', authorize('admin'), getUserById);
