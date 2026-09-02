/**
 * Gemini AI Service for FeedLink AI
 *
 * Provides AI-powered food analysis and NGO match explanations.
 * All methods degrade gracefully when GEMINI_API_KEY is not set
 * or the API is unavailable — returning null so callers can fall
 * back to deterministic logic.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

// ---------------------------------------------------------------------------
// Client initialisation (lazy, safe when key is absent)
// ---------------------------------------------------------------------------

let genAI: GoogleGenerativeAI | null = null;

const getClient = (): GoogleGenerativeAI | null => {
  if (genAI) return genAI;
  if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === '') {
    console.log('[Gemini] API key not configured — AI analysis disabled');
    return null;
  }
  try {
    genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    return genAI;
  } catch (error) {
    console.error('[Gemini] Failed to initialise client:', error);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Types returned by the AI
// ---------------------------------------------------------------------------

export interface AiUrgencyResult {
  urgencyScore: number;        // 0–100
  urgencyLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendedAction: string;
  explanation: string;
  shelfLifeEstimate: string;
  storageRecommendations: string[];
}

export interface AiMatchExplanation {
  matchScore: number;          // 0–100
  explanation: string;
  keyFactors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse JSON from a Gemini text response.
 * Gemini may wrap JSON in markdown code fences — strip those first.
 */
const parseGeminiJson = <T>(raw: string): T | null => {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(cleaned) as T;
  } catch {
    console.warn('[Gemini] Failed to parse JSON response:', raw.slice(0, 200));
    return null;
  }
};

/**
 * Call Gemini with a timeout. Returns null on any failure.
 */
const callGemini = async (
  prompt: string,
  timeoutMs = 90_000,
): Promise<string | null> => {
  const client = getClient();
  if (!client) return null;

  try {
    const model = client.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini timeout')), timeoutMs),
    );

    const result = await Promise.race([
      model.generateContent(prompt),
      timeoutPromise,
    ]);

    const text = result.response.text();
    return text || null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Gemini] API call failed:', msg);
    return null;
  }
};

// ---------------------------------------------------------------------------
// 1. AI Food Analysis
// ---------------------------------------------------------------------------

interface AnalyzeFoodInput {
  title: string;
  description: string;
  foodCategory: string;
  quantity: string;
  unit: string;
  servings: number | null;
  expiryDate: string;
  pickupCity: string;
}

const FOOD_ANALYSIS_PROMPT = (input: AnalyzeFoodInput) => `
You are an AI assistant for FeedLink AI, a surplus food redistribution platform.
Analyze the following food donation and assess its urgency and distribution needs.

Donation details:
- Title: ${input.title}
- Description: ${input.description || 'N/A'}
- Food category: ${input.foodCategory}
- Quantity: ${input.quantity} ${input.unit}
- Servings: ${input.servings ?? 'unknown'}
- Expiry date: ${input.expiryDate}
- Pickup city: ${input.pickupCity}

Current time: ${new Date().toISOString()}

Respond ONLY with a JSON object (no markdown, no explanation outside JSON):
{
  "urgencyScore": <integer 0-100, where 100 is most urgent>,
  "urgencyLevel": "<LOW | MEDIUM | HIGH | CRITICAL>",
  "recommendedAction": "<one sentence on what should be done>",
  "explanation": "<2-3 sentences explaining why this urgency level was assigned>",
  "shelfLifeEstimate": "<human-readable remaining shelf life>",
  "storageRecommendations": ["<tip 1>", "<tip 2>", "<tip 3>"]
}

Prioritise food that is close to expiry. Fresh produce and prepared meals near
expiry should score higher. Packaged goods with long shelf life should score lower.
`;

export const analyzeFoodDonation = async (
  input: AnalyzeFoodInput,
): Promise<AiUrgencyResult | null> => {
  const raw = await callGemini(FOOD_ANALYSIS_PROMPT(input));
  if (!raw) return null;

  const parsed = parseGeminiJson<AiUrgencyResult>(raw);
  if (!parsed) return null;

  // Validate & clamp
  const score = Math.max(0, Math.min(100, Math.round(parsed.urgencyScore || 50)));
  const validLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const level = validLevels.includes(parsed.urgencyLevel as typeof validLevels[number])
    ? parsed.urgencyLevel
    : score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';

  return {
    urgencyScore: score,
    urgencyLevel: level,
    recommendedAction: parsed.recommendedAction || 'Distribute as soon as possible.',
    explanation: parsed.explanation || 'Analysis unavailable.',
    shelfLifeEstimate: parsed.shelfLifeEstimate || 'Unknown',
    storageRecommendations: Array.isArray(parsed.storageRecommendations)
      ? parsed.storageRecommendations.slice(0, 5)
      : ['Keep refrigerated if applicable', 'Check condition before distribution'],
  };
};

// ---------------------------------------------------------------------------
// 2. AI Match Explanation
// ---------------------------------------------------------------------------

interface ExplainMatchInput {
  donationTitle: string;
  foodCategory: string;
  quantity: string;
  unit: string;
  urgencyLevel: string;
  urgencyScore: number;
  ngoName: string;
  ngoCity: string;
  ngoActiveDonations: number;
  ngoPastCategoryMatches: number;
  pickupCity: string;
}

const MATCH_EXPLANATION_PROMPT = (input: ExplainMatchInput) => `
You are an AI assistant for FeedLink AI, a surplus food redistribution platform.
Explain why the following NGO is a good match for this food donation.

Donation:
- Title: ${input.donationTitle}
- Category: ${input.foodCategory}
- Quantity: ${input.quantity} ${input.unit}
- Urgency: ${input.urgencyLevel} (score: ${input.urgencyScore}/100)
- Pickup city: ${input.pickupCity}

NGO:
- Name: ${input.ngoName}
- City: ${input.ngoCity || 'unknown'}
- Active donations being handled: ${input.ngoActiveDonations}
- Past successful matches in this category: ${input.ngoPastCategoryMatches}

Respond ONLY with a JSON object (no markdown, no explanation outside JSON):
{
  "matchScore": <integer 0-100>,
  "explanation": "<2-3 sentence human-readable explanation of why this NGO was recommended>",
  "keyFactors": ["<factor 1>", "<factor 2>", "<factor 3>"]
}

Consider: proximity (same city), capacity (fewer active = better),
category experience, and urgency. Be concise and factual.
`;

export const explainNgoMatch = async (
  input: ExplainMatchInput,
): Promise<AiMatchExplanation | null> => {
  const raw = await callGemini(MATCH_EXPLANATION_PROMPT(input));
  if (!raw) return null;

  const parsed = parseGeminiJson<AiMatchExplanation>(raw);
  if (!parsed) return null;

  const score = Math.max(0, Math.min(100, Math.round(parsed.matchScore || 50)));

  return {
    matchScore: score,
    explanation: parsed.explanation || 'Match based on capacity and proximity.',
    keyFactors: Array.isArray(parsed.keyFactors)
      ? parsed.keyFactors.slice(0, 5)
      : ['Proximity', 'Available capacity'],
  };
};

// ---------------------------------------------------------------------------
// Utility: is AI available?
// ---------------------------------------------------------------------------

export const isAiAvailable = (): boolean => {
  return getClient() !== null;
};
