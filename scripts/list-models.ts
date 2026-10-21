/** Lists the Gemini models your API key can call. Run: npm run llm:models */
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY is not set (put it in .env)'); process.exit(2); }
const ai = new GoogleGenAI({ apiKey: key });
const names: string[] = [];
for await (const m of await ai.models.list()) {
  if ((m.supportedActions ?? []).includes('generateContent') && /gemini/i.test(m.name ?? '')) names.push((m.name ?? '').replace('models/', ''));
}
console.log(names.sort().join('\n'));
console.log('\nPut your choice in .env, e.g.:  GEMINI_MODEL=' + ('gemini-3.8-flash,gemini-flash-latest,gemini-3.1-pro-preview'));
