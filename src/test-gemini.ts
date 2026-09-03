/**
 * Gemini diagnostic test — does NOT print the API key.
 * Run: cd backend && npx tsx src/test-gemini.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';

async function diagnose() {
  // 1. Check env var
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === '') {
    console.log('[DIAG] GEMINI_API_KEY is empty or not set in .env');
    console.log('[DIAG] Make sure backend/.env contains: GEMINI_API_KEY=<your-key>');
    return;
  }
  console.log(`[DIAG] GEMINI_API_KEY is set (length: ${key.length}, starts with: ${key.slice(0, 4)}...)`);

  // 2. Initialise client
  let genAI: GoogleGenerativeAI;
  try {
    genAI = new GoogleGenerativeAI(key);
    console.log('[DIAG] GoogleGenerativeAI client created successfully');
  } catch (error) {
    console.error('[DIAG] Failed to create client:', error);
    return;
  }

  // 3. Test models
  const modelsToTest = [
    'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ];

  for (const modelName of modelsToTest) {
    console.log(`\n[DIAG] Testing model: ${modelName}`);
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Reply with exactly: {"ok":true}');
      const text = result.response.text();
      console.log(`[DIAG] SUCCESS — response (${text.length} chars): ${text.slice(0, 120)}`);
      // If this model works, we're done
      console.log(`\n[DIAG] ✅ Model "${modelName}" works correctly.`);
      return;
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error(`[DIAG] FAILED — ${modelName}: ${msg.slice(0, 300)}`);
    }
  }

  console.log('\n[DIAG] All models failed. Check your API key permissions and quota.');
}

diagnose().catch(console.error);
