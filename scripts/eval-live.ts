/**
 * Runs tests/corpus through the REAL Gemini model and compares with the ground truth.
 *   npm run eval:live              # needs GEMINI_API_KEY in .env
 *   npm run eval:live -- --record  # also save the model's answers as tests/corpus/*.llm.json fixtures
 * Exit code 1 if any document is read wrongly.
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../server/store';
import { ingestDocument } from '../server/ingest';
import { GeminiProvider, RecordingProvider } from '../server/extraction/providers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = path.join(root, 'tests', 'corpus');
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY is not set (put it in .env)'); process.exit(2); }

const record = process.argv.includes('--record');
let provider: any = new GeminiProvider(key);
if (record) provider = new RecordingProvider(provider, corpus);

const files = fs.readdirSync(corpus).filter(f => !f.endsWith('.expected.json') && !f.endsWith('.llm.json')).sort();
let bad = 0;

async function main() {
  console.log(`Model(s): ${process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview,gemini-3.8-flash'}${record ? '   (recording fixtures)' : ''}\n`);
  for (const f of files) {
    const exp = JSON.parse(fs.readFileSync(path.join(corpus, f + '.expected.json'), 'utf8'));
    const store = new JsonStore(path.join(os.tmpdir(), `eval-${process.pid}-${Math.random()}.json`), path.join(root, 'data', 'seed.json'));
    store.reset();
    const t0 = Date.now();
    const r = await ingestDocument(store, { filename: f, dataBase64: fs.readFileSync(path.join(corpus, f)).toString('base64') }, { provider, source: 'test' });
    const problems: string[] = [];
    if (!r.ok) problems.push(`error: ${r.error}`);
    if (r.intent.toLowerCase() !== exp.type) problems.push(`type ${r.intent} != ${exp.type}`);
    const e = r.extraction;
    if (exp.type === 'invoice' && e) {
      if (e.invoice_number !== exp.invoice_number) problems.push(`invoice_number ${e.invoice_number} != ${exp.invoice_number}`);
      if (e.po_number !== exp.po) problems.push(`po ${e.po_number} != ${exp.po}`);
      if (e.total_amount !== exp.total) problems.push(`total ${e.total_amount} != ${exp.total}`);
      if (exp.freight !== undefined && (e.freight_amount ?? 0) !== exp.freight) problems.push(`freight ${e.freight_amount} != ${exp.freight}`);
    }
    if (exp.match && r.match?.status !== exp.match) problems.push(`match ${r.match?.status ?? 'none'} != ${exp.match}`);
    if (exp.code && r.match?.code !== exp.code) problems.push(`code ${r.match?.code} != ${exp.code}`);
    if (exp.type === 'acknowledgement' && e?.acknowledgement?.status !== exp.ack_status) problems.push(`ack ${e?.acknowledgement?.status} != ${exp.ack_status}`);
    if (r.provider !== 'gemini') problems.push(`NOT READ BY GEMINI (${r.provider}): ${r.warnings.find(w => /LLM call failed/.test(w)) ?? r.error ?? ''}`);
    if (problems.length) bad++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${f.padEnd(26)} ${String(Date.now() - t0).padStart(5)}ms  conf ${r.confidence}%  ${problems.join('; ')}`);
  }
  console.log(`\n${files.length - bad}/${files.length} read correctly`);
  process.exit(bad ? 1 : 0);
}
await main();
