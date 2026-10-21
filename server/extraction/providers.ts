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
import { GoogleGenAI } from '@google/genai';
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

export class GeminiProvider implements Provider {
  name = 'gemini' as const;
  private ai: GoogleGenAI;
  private models: string[];

  constructor(apiKey: string, models = (process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview,gemini-2.5-flash')) {
    this.ai = new GoogleGenAI({ apiKey });
    this.models = models.split(',').map(m => m.trim()).filter(Boolean);
  }

  async extract(input: ExtractInput): Promise<ProviderResult> {
    const parts: any[] = [
      { text: `Source file name: ${input.filename}\n\n${input.text ? `Document text / email:\n${input.text}` : '(No text layer: read the attached file.)'}` },
      ...input.attachments.map(a => ({ inlineData: { mimeType: a.mimeType, data: a.dataBase64 } })),
    ];
    let lastErr: unknown;
    for (const model of this.models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await this.ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction: SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA as any,
              temperature: 0,
            },
          });
          const text = res.text ?? '';
          return { raw: JSON.parse(text), model };
        } catch (e: any) {
          lastErr = e;
          const msg = String(e?.message ?? e);
          // Model unavailable -> try the next configured model; transient/JSON -> retry once.
          if (/not found|404|unsupported|not supported|deprecated/i.test(msg)) break;
          if (/api key|permission|401|403/i.test(msg)) throw e;
        }
      }
    }
    throw lastErr ?? new Error('Gemini returned no result');
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
