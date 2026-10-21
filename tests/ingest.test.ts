import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { JsonStore } from '../server/store';
import { ingestDocument } from '../server/ingest';
import { drainInbox } from '../server/inbox';
import { FixtureProvider, RulesProvider } from '../server/extraction/providers';
import type { Provider } from '../server/extraction/providers';
import { audit, coerce } from '../server/extraction/normalize';

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(__dirname, 'corpus');
const SEED = path.join(ROOT, 'data', 'seed.json');

const files = fs.readdirSync(CORPUS).filter(f => !f.endsWith('.expected.json') && !f.endsWith('.llm.json'));
const expected = (f: string) => JSON.parse(fs.readFileSync(path.join(CORPUS, f + '.expected.json'), 'utf8'));
const raw = (f: string) => ({ filename: f, dataBase64: fs.readFileSync(path.join(CORPUS, f)).toString('base64') });

let tmp = '';
let store: JsonStore;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ingest-')); });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => { store = new JsonStore(path.join(tmp, `db-${Math.random()}.json`), SEED); store.reset(); });

const fixture = new FixtureProvider(CORPUS);

describe('corpus: every document type through the fixture (recorded-model) provider', () => {
  it('corpus has the expected breadth', () => {
    expect(files.length).toBeGreaterThanOrEqual(11);
    for (const f of files) {
      expect(fs.existsSync(path.join(CORPUS, f + '.expected.json')), f).toBe(true);
      expect(fs.existsSync(path.join(CORPUS, f + '.llm.json')), f).toBe(true);
    }
  });

  for (const f of files) {
    it(`${f}`, async () => {
      const exp = expected(f);
      const r = await ingestDocument(store, raw(f), { provider: fixture, source: 'test' });
      expect(r.ok, r.error).toBe(true);
      expect(r.intent.toLowerCase()).toBe(exp.type);
      if (exp.type === 'invoice') {
        expect(r.extraction?.invoice_number).toBe(exp.invoice_number);
        expect(r.extraction?.po_number).toBe(exp.po);
        expect(r.extraction?.total_amount).toBe(exp.total);
        if (exp.freight !== undefined) expect(r.extraction?.freight_amount ?? 0).toBe(exp.freight);
      }
      if (exp.match) {
        expect(r.match?.status).toBe(exp.match);
        if (exp.code) expect(r.match?.code).toBe(exp.code);
        expect(r.status).toBe(exp.match === 'Success' ? 'Auto-posted' : 'Needs Review');
      }
      if (exp.status) expect(r.status).toBe(exp.status);
      if (exp.warning) expect(r.warnings.join(' ')).toContain(exp.warning);
      if (exp.type === 'acknowledgement') {
        const po = store.snapshot().purchaseorders.find((p: any) => p.po_number === exp.po);
        expect(po.ack_status).toBe(exp.ack_status);
        expect(po.expected_eta).toContain(exp.eta);
        expect(r.status).toBe('Matched');
      }
    });
  }
});

describe('offline rules provider (no API key)', () => {
  for (const f of files.filter(x => expected(x).rules_ok !== false && !expected(x).needs_llm)) {
    it(`reads ${f} without an LLM`, async () => {
      const exp = expected(f);
      const r = await ingestDocument(store, raw(f), { provider: new RulesProvider(), source: 'test' });
      expect(r.intent.toLowerCase()).toBe(exp.type);
      if (exp.type === 'invoice') {
        expect(r.extraction?.invoice_number).toBe(exp.invoice_number);
        expect(r.extraction?.po_number).toBe(exp.po);
        expect(r.extraction?.total_amount).toBe(exp.total);
      }
      if (exp.match) expect(r.match?.status).toBe(exp.match);
    });
  }

  it('image with no text: clear "needs a Gemini key" message, nothing posted', async () => {
    const r = await ingestDocument(store, raw('scanned_invoice.png'), { provider: new RulesProvider(), source: 'test' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('Needs Review');
    expect(r.error).toMatch(/GEMINI_API_KEY/);
    expect(store.snapshot().vendorinvoices).toHaveLength(15);
  });
});

describe('business rules at the door', () => {
  it('duplicate = same invoice number alone, regardless of vendor/PO/file', async () => {
    const a = await ingestDocument(store, raw('XYZ_Company.pdf'), { provider: fixture });
    const b = await ingestDocument(store, raw('EFGHI_Company.pdf'), { provider: fixture });
    expect(a.match?.code).toBe('FREIGHT');
    expect(b.match?.code).toBe('DUPLICATE');
    expect(b.docId).toBe('INV-88392-2');
  });

  it('re-ingesting the same file is caught as a duplicate, not double-booked', async () => {
    await ingestDocument(store, raw('paragraph_invoice.txt'), { provider: fixture });
    const again = await ingestDocument(store, { ...raw('paragraph_invoice.txt'), filename: 'paragraph_invoice.txt' }, { provider: fixture });
    expect(again.match?.code).toBe('DUPLICATE');
    expect(store.snapshot().successreports.filter((r: any) => r.invoice_number === 'INV-5001')).toHaveLength(1);
  });

  it('pasted text goes through the same pipeline', async () => {
    const r = await ingestDocument(store, { filename: 'paragraph_invoice.txt', text: fs.readFileSync(path.join(CORPUS, 'paragraph_invoice.txt'), 'utf8') }, { provider: fixture, source: 'ui' });
    expect(r.match?.status).toBe('Success');
    expect(store.snapshot().ingesteddocuments.find((d: any) => d.id === r.docId).source).toBe('ui');
  });

  it('low-confidence reads are held for review and NOT matched', async () => {
    const low: Provider = { name: 'gemini', extract: async () => ({ raw: { ...JSON.parse(fs.readFileSync(path.join(CORPUS, 'paragraph_invoice.txt.llm.json'), 'utf8')), confidence: 0.3 }, model: 'x' }) };
    const r = await ingestDocument(store, raw('paragraph_invoice.txt'), { provider: low });
    expect(r.status).toBe('Needs Review');
    expect(r.match).toBeNull();
    const inv = store.snapshot().vendorinvoices.find((i: any) => i.invoice_number === 'INV-5001');
    expect(inv.match_status).toBe('Needs Review');
    // the default batch must not pick it up
    const { runMatch } = await import('../server/matchService');
    await runMatch(store, { actor: 'test' });
    expect(store.snapshot().vendorinvoices.find((i: any) => i.invoice_number === 'INV-5001').match_status).toBe('Needs Review');
  });

  it('LLM outage: loud fallback to rules parser, flagged, never auto-posted', async () => {
    const down: Provider = { name: 'gemini', extract: async () => { throw new Error('503 overloaded'); } };
    const r = await ingestDocument(store, raw('paragraph_invoice.txt'), { provider: down });
    expect(r.provider).toBe('rules-fallback');
    expect(r.status).toBe('Needs Review');
    expect(r.warnings.join(' ')).toMatch(/LLM call failed/);
  });

  it('LLM outage on a scan: recorded as Needs Review with the error, no crash', async () => {
    const down: Provider = { name: 'gemini', extract: async () => { throw new Error('API key not valid'); } };
    const r = await ingestDocument(store, raw('scanned_invoice.png'), { provider: down });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/API key/);
    expect(store.snapshot().ingesteddocuments.some((d: any) => d.document_name === 'scanned_invoice.png' && d.status === 'Needs Review')).toBe(true);
  });

  it('hallucinated total (not in the source text) is penalised and flagged', () => {
    const ext = coerce({ document_type: 'invoice', confidence: 0.97, invoice_number: 'INV-1', po_number: 'PO-2024-100', total_amount: 999.99, line_items: [], evidence: [] });
    const a = audit(ext, 'Invoice INV-1 for PO-2024-100, total $500.00');
    expect(a.confidence).toBeLessThan(0.97);
    expect(a.warnings.join(' ')).toMatch(/total/i);
  });

  it('"no freight" (0) is not flagged as a hallucination', () => {
    const ext = coerce({ document_type: 'invoice', confidence: 0.95, invoice_number: 'INV-1', po_number: 'PO-2024-100', total_amount: 500, freight_amount: 0, line_items: [], evidence: [] });
    const a = audit(ext, 'Invoice INV-1 for PO-2024-100, total $500.00. No freight.');
    expect(a.warnings).toHaveLength(0);
  });

  it('unsupported file type is rejected cleanly', async () => {
    const r = await ingestDocument(store, { filename: 'x.zip', dataBase64: Buffer.from('PK').toString('base64') }, { provider: fixture });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unsupported/);
  });

  it('ingest + reset leaves the golden dataset untouched', async () => {
    await ingestDocument(store, raw('paragraph_invoice.txt'), { provider: fixture });
    store.reset();
    const s = store.snapshot();
    expect(s.vendorinvoices).toHaveLength(15);
    expect(s.ingesteddocuments).toHaveLength(7);
  });
});

describe('inbox folder + HTTP API', () => {
  it('inbox: files are ingested and moved to processed/failed', async () => {
    const dir = path.join(tmp, 'inbox-' + Math.random());
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(CORPUS, 'table_in_email.txt'), path.join(dir, 'table_in_email.txt'));
    fs.writeFileSync(path.join(dir, 'junk.txt'), '   ');
    const old = new Date(Date.now() - 5000);
    for (const n of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, n), old, old);
    const n = await drainInbox(store, fixture, dir);
    expect(n).toBe(2);
    expect(fs.readdirSync(path.join(dir, 'processed')).some(x => x.endsWith('table_in_email.txt'))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'failed')).some(x => x.endsWith('junk.txt'))).toBe(true);
    expect(store.snapshot().vendorinvoices.some((i: any) => i.invoice_number === 'INV-5006')).toBe(true);
  });

  describe('HTTP', () => {
    let server: Server; let base = '';
    beforeAll(async () => {
      const s = new JsonStore(path.join(tmp, 'http.json'), SEED);
      server = createApp({ store: s, provider: fixture, providerReason: 'test' }).listen(0, '127.0.0.1');
      await new Promise(r => server.once('listening', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => { server.close(); });
    const post = (u: string, b: unknown) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

    it('POST /api/ingest (base64 file)', async () => {
      await post('/api/reset', {});
      const j = await (await post('/api/ingest', { filename: 'forwarded_chain.eml', dataBase64: raw('forwarded_chain.eml').dataBase64 })).json();
      expect(j.error).toBeNull();
      expect(j.data.match.status).toBe('Success');
    });
    it('POST /api/ingest validates input', async () => {
      const res = await post('/api/ingest', { filename: 'a.txt' });
      expect(res.status).toBe(400);
    });
    it('GET /api/llm/status', async () => {
      const j = await (await fetch(base + '/api/llm/status')).json();
      expect(j.data.provider).toBe('fixture');
      expect(j.data.live).toBe(false);
    });
  });
});
