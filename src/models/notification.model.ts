// Notification model - ready for database integration
export interface NotificationModel {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  created_at: Date;
}
