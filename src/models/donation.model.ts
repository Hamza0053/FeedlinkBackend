// Donation model - ready for database integration
export interface DonationModel {
  id: string;
  donor_id: string;
  title: string;
  description: string;
  food_category: string;
  quantity: string;
  unit: string;
  expiry_date: Date;
  pickup_address: string;
  pickup_city: string;
  pickup_instructions?: string;
  images?: string[];
  status: string;
  urgency_level: string;
  urgency_score?: number;
  ai_analysis?: Record<string, unknown>;
  matched_ngo_id?: string;
  claimed_at?: Date;
  pickup_scheduled_at?: Date;
  delivered_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}
