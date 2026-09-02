import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getNotifications,
  getUnreadCountHandler,
  markAsRead,
  markAllAsRead,
} from '../controllers/notification.controller';

export const notificationRouter = Router();

notificationRouter.use(authenticate);

notificationRouter.get('/', getNotifications);
notificationRouter.get('/unread-count', getUnreadCountHandler);
notificationRouter.patch('/:id/read', markAsRead);
notificationRouter.patch('/read-all', markAllAsRead);
