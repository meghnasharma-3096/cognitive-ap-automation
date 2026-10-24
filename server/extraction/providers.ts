/**
 * Extraction providers. All implement the same tiny interface so the pipeline,
 * the API and the tests don't care which one is behind it.
 *
 *   gemini   real LLM (needs GEMINI_API_KEY)
 *   fixture  replays recorded model output from tests/corpus  (tests, offline demos)
 *   rules    deterministic regex parser; works on text only. Safety net, never the "smart" path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT } from './schema';
import { rulesExtract } from './rules';

export interface Attachment { mimeType: string; dataBase64: string; filename?: string }

export interface ExtractInput {
  filename: string;
  /** Email headers/body, pasted text, or text pulled from a PDF. */
  text: string;
  /** Raw bytes the model should look at directly (scans, PDFs, images). */
  attachments: Attachment[];
}

export interface ProviderResult { raw: unknown; model?: string }

export interface Provider {
  name: 'gemini' | 'fixture' | 'rules';
  extract(input: ExtractInput): Promise<ProviderResult>;
}

// ------------------------------------------------------------------ gemini

const THINK: Record<string, ThinkingLevel> = { minimal: ThinkingLevel.MINIMAL, low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

export class GeminiProvider implements Provider {
  name = 'gemini' as const;
  private ai: GoogleGenAI;
  private models: string[];
  /** Extraction needs little reasoning; low thinking is far faster. GEMINI_THINKING=low|minimal|medium|high|off */
  private thinking: string = (process.env.GEMINI_THINKING ?? 'low').toLowerCase();
  /** Optional progress messages (attempt, waiting heartbeat, result). Set GEMINI_VERBOSE=1 to print them in the server too. */
  onProgress: ((msg: string) => void) | null = process.env.GEMINI_VERBOSE ? (m => console.log(`[gemini] ${m}`)) : null;

  constructor(apiKey: string, models = (process.env.GEMINI_MODEL ?? 'gemini-3.8-flash,gemini-flash-latest,gemini-3.1-pro-preview')) {
    this.ai = new GoogleGenAI({ apiKey });
    this.models = models.split(',').map(m => m.trim()).filter(Boolean);
  }

  async extract(input: ExtractInput): Promise<ProviderResult> {
    const parts: any[] = [
      { text: `Source file name: ${input.filename}\n\n${input.text ? `Document text / email:\n${input.text}` : '(No text layer: read the attached file.)'}` },
      ...input.attachments.map(a => ({ inlineData: { mimeType: a.mimeType, data: a.dataBase64 } })),
    ];
    const errs: string[] = [];
    const say = (m: string) => this.onProgress?.(m);
    const kb = Math.round(input.attachments.reduce((n, a) => n + a.dataBase64.length * 0.75, 0) / 1024);
    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 90000);
    for (const model of this.models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const t0 = Date.now();
        say(`${input.filename}: asking ${model} (try ${attempt}/3, ${kb} KB attached, gives up after ${Math.round(timeoutMs / 1000)}s)`);
        const beat = this.onProgress ? setInterval(() => say(`   ...still waiting on ${model} (${Math.round((Date.now() - t0) / 1000)}s)`), 10000) : null;
        try {
          const res = await this.ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction: SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA as any,
              temperature: 0,
              httpOptions: { timeout: timeoutMs },
              ...(this.thinking !== 'off' && THINK[this.thinking] ? { thinkingConfig: { thinkingLevel: THINK[this.thinking] } } : {}),
            },
          });
          say(`   answer received from ${model} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          return { raw: JSON.parse(res.text ?? ''), model };
        } catch (e: any) {
          const msg = String(e?.message ?? e).replace(/\s+/g, ' ');
          say(`   ${model} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${msg.slice(0, 140)}`);
          // Model doesn't accept the thinking setting: stop sending it and retry straight away.
          if (this.thinking !== 'off' && /thinking/i.test(msg) && /INVALID_ARGUMENT|400|not supported/i.test(msg)) { this.thinking = 'off'; attempt--; continue; }
          if (/api key|permission|401|403|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg) && !/not found/i.test(msg)) throw e;
          // Overloaded / rate limited: wait and retry the same model.
          const dailyQuota = /PerDay|per day|free_tier_requests/i.test(msg) && /429|RESOURCE_EXHAUSTED/i.test(msg);
          if (dailyQuota) { errs.push(`${model}: DAILY_QUOTA`); break; }
          if (attempt < 3 && /429|503|504|500|overloaded|unavailable|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL|JSON/i.test(msg) && !/404|not found|no longer available/i.test(msg)) {
            const wait = (/429|RESOURCE_EXHAUSTED/i.test(msg) ? 8000 : 1500) * attempt;
            say(`   retrying ${model} in ${wait / 1000}s`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          errs.push(`${model}: ${msg.slice(0, 180)}`);
          say(`   giving up on ${model}, trying the next model`);
          break; // timeout, 404, or out of retries -> next model
        } finally {
          if (beat) clearInterval(beat);
        }
      }
    }
    if (errs.length && errs.every(e => /DAILY_QUOTA/.test(e))) {
      throw new Error('Gemini daily request limit reached for this API key (free tier allows ~20 requests/day per model). Turn on billing for the key in Google AI Studio, or try again after the limit resets.');
    }
    throw new Error(errs.join(' | ') || 'Gemini returned no result');
  }
}

// ----------------------------------------------------------------- fixture

export class FixtureProvider implements Provider {
  name = 'fixture' as const;
  constructor(private dir: string) {}
  fixturePath(filename: string) {
    return path.join(this.dir, `${path.basename(filename)}.llm.json`);
  }
  async extract(input: ExtractInput): Promise<ProviderResult> {
    const p = this.fixturePath(input.filename);
    if (!fs.existsSync(p)) throw new Error(`No recorded LLM fixture for "${input.filename}" (${p})`);
    return { raw: JSON.parse(fs.readFileSync(p, 'utf8')), model: 'fixture' };
  }
}

/** Wraps a real provider and records its answers as fixtures (npm run eval:live -- --record). */
export class RecordingProvider implements Provider {
  name: Provider['name'];
  constructor(private inner: Provider, private dir: string) { this.name = inner.name; }
  async extract(input: ExtractInput): Promise<ProviderResult> {
    const out = await this.inner.extract(input);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${path.basename(input.filename)}.llm.json`), JSON.stringify(out.raw, null, 2) + '\n');
    return out;
  }
}

// ------------------------------------------------------------------- rules

export class RulesProvider implements Provider {
  name = 'rules' as const;
  async extract(input: ExtractInput): Promise<ProviderResult> {
    return { raw: rulesExtract(input.text), model: 'rules' };
  }
}

// ---------------------------------------------------------------- selection

export interface ProviderChoice { provider: Provider; reason: string }

export function chooseProvider(env: NodeJS.ProcessEnv = process.env, fixtureDir?: string): ProviderChoice {
  const want = (env.LLM_PROVIDER ?? '').toLowerCase();
  if (want === 'fixture') {
    return { provider: new FixtureProvider(fixtureDir ?? path.join(process.cwd(), 'tests', 'corpus')), reason: 'LLM_PROVIDER=fixture' };
  }
  if (want === 'rules') return { provider: new RulesProvider(), reason: 'LLM_PROVIDER=rules (offline)' };
  if (env.GEMINI_API_KEY) return { provider: new GeminiProvider(env.GEMINI_API_KEY), reason: 'GEMINI_API_KEY set' };
  return { provider: new RulesProvider(), reason: 'No GEMINI_API_KEY: using offline rules parser (text only)' };
}
