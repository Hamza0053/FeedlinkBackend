import { Router } from 'express';
import { authRouter } from './auth.routes';
import { donationRouter } from './donation.routes';
import { userRouter } from './user.routes';
import { statsRouter } from './stats.routes';
import { notificationRouter } from './notification.routes';
import { requirementRouter } from './requirement.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/donations', donationRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/stats', statsRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/requirements', requirementRouter);
