import { pool } from '../config/database';

export type NotificationType =
  | 'donation_created'
  | 'donation_matched'
  | 'donation_claimed'
  | 'pickup_scheduled'
  | 'pickup_reminder'
  | 'donation_completed'
  | 'donation_expired'
  | 'new_available'
  | 'requirement_matched'
  | 'requirement_fulfilled'
  | 'system';

export const createNotification = async (
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  link?: string
): Promise<void> => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, message, link || null]
    );
  } catch (error) {
    // Don't fail the main operation if notification creation fails
    console.error('Failed to create notification:', error);
  }
};

export const getUnreadCount = async (userId: string): Promise<number> => {
  const result = await pool.query(
    'SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1 AND read = false',
    [userId]
  );
  return result.rows[0].count;
};
