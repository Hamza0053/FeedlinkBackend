/**
 * Gemma 4 diagnostic test — does NOT print the API key.
 * Run: cd backend && npx tsx src/test-gemini.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';

async function diagnose() {
  // 1. Check env var
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.trim() === '') {
    console.log('[DIAG] OPENROUTER_API_KEY is empty or not set in .env');
    console.log('[DIAG] Make sure backend/.env contains: OPENROUTER_API_KEY=<your-key>');
    return;
  }
  console.log(`[DIAG] OPENROUTER_API_KEY is set (length: ${key.length}, starts with: ${key.slice(0, 7)}...)`);

  // 2. Initialise OpenRouter client
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: key,
    defaultHeaders: {
      'HTTP-Referer': 'https://feedlink.ai',
      'X-Title': 'FeedLink AI',
    },
  });
  console.log('[DIAG] OpenRouter client created successfully');

  // 3. Test Gemma 4 model
  const model = 'google/gemma-4-27b-it:free';
  console.log(`\n[DIAG] Testing model: ${model}`);
  try {
    const result = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: {"ok":true}' }],
      max_tokens: 32,
    });
    const text = result.choices[0]?.message?.content ?? '';
    console.log(`[DIAG] SUCCESS — response (${text.length} chars): ${text.slice(0, 120)}`);
    console.log(`\n[DIAG] ✅ Model "${model}" works correctly.`);
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`[DIAG] FAILED — ${model}: ${msg.slice(0, 300)}`);
    console.log('\n[DIAG] Check your OPENROUTER_API_KEY and account at https://openrouter.ai');
  }
}

diagnose().catch(console.error);
