// NGO Requirement model types

export type RequirementStatus = 'active' | 'fulfilled' | 'expired' | 'cancelled';

export type RequirementUrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export interface NgoRequirement {
  id: string;
  ngo_id: string;
  title: string;
  description: string | null;
  food_category: string;
  quantity_needed: number;
  unit: string;
  remaining_quantity: number;
  needed_from: string;
  needed_until: string;
  pickup_city: string;
  urgency_level: RequirementUrgencyLevel;
  status: RequirementStatus;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
}

// camelCase version for API responses
export interface NgoRequirementResponse {
  id: string;
  ngoId: string;
  title: string;
  description: string | null;
  foodCategory: string;
  quantityNeeded: number;
  unit: string;
  remainingQuantity: number;
  neededFrom: string;
  neededUntil: string;
  pickupCity: string;
  urgencyLevel: RequirementUrgencyLevel;
  status: RequirementStatus;
  fulfilledAt: string | null;
  ngoName?: string;
  ngoOrganization?: string;
  createdAt: string;
  updatedAt: string;
}

// Map DB row (snake_case) to API response (camelCase)
export const mapRequirement = (row: Record<string, any>): NgoRequirementResponse => ({
  id: row.id as string,
  ngoId: row.ngo_id as string,
  title: row.title as string,
  description: (row.description as string) || null,
  foodCategory: row.food_category as string,
  quantityNeeded: parseFloat(String(row.quantity_needed)),
  unit: row.unit as string,
  remainingQuantity: parseFloat(String(row.remaining_quantity)),
  neededFrom: row.needed_from as string,
  neededUntil: row.needed_until as string,
  pickupCity: row.pickup_city as string,
  urgencyLevel: row.urgency_level as RequirementUrgencyLevel,
  status: row.status as RequirementStatus,
  fulfilledAt: (row.fulfilled_at as string) || null,
  ngoName: row.ngo_name as string | undefined,
  ngoOrganization: row.ngo_organization as string | undefined,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});
