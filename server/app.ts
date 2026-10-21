import express from 'express';
import type { Express } from 'express';
import { JsonStore } from './store';
import type { Query } from './store';
import { approveInvoice, runMatch } from './matchService';
import { buildClusters, resolveCluster } from './clusters';
import { ingestDocument } from './ingest';
import type { IngestSource } from './ingest';
import { RulesProvider } from './extraction/providers';
import type { Provider } from './extraction/providers';

export interface AppDeps {
  store: JsonStore;
  /** Extraction provider (Gemini / fixture / rules). Defaults to the offline rules parser. */
  provider?: Provider;
  providerReason?: string;
}

/** API-only Express app (no Vite). Tests mount this directly. */
export function createApp({ store, provider = new RulesProvider(), providerReason = 'default' }: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '60mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, counts: store.counts() });
  });

  // Supabase-compatible query endpoint (see src/services/supabase.ts)
  app.post('/api/db', async (req, res) => {
    const q = req.body as Query;
    if (!q || typeof q.table !== 'string' || !q.op) {
      res.status(400).json({ data: null, error: { message: 'Bad query', code: 'BAD_QUERY', details: '', hint: '' } });
      return;
    }
    res.json(await store.run(q));
  });

  // Restore the golden seed dataset.
  app.post('/api/reset', (_req, res) => {
    res.json({ data: store.reset(), error: null });
  });

  // Empty every table (blank slate for demos / tests).
  app.post('/api/clear', (_req, res) => {
    res.json({ data: store.clear(), error: null });
  });

  // Run the three-way match. Body: { invoiceIds?: string[], all?: boolean }
  app.post('/api/match/run', async (req, res) => {
    const { invoiceIds, all } = req.body ?? {};
    res.json({ data: await runMatch(store, { invoiceIds, all, actor: 'user' }), error: null });
  });

  // Human override of a flagged invoice. Body: { invoiceId }
  app.post('/api/match/approve', async (req, res) => {
    const { invoiceId } = req.body ?? {};
    const r = await approveInvoice(store, String(invoiceId ?? ''), 'user');
    res.status(r.ok ? 200 : 404).json({ data: r, error: r.ok ? null : { message: r.message, code: 'NOT_FOUND', details: '', hint: '' } });
  });

  // Intelligence clusters: computed from live match results, never seeded.
  app.get('/api/clusters', async (_req, res) => {
    res.json({ data: await store.transact(t => buildClusters(t)), error: null });
  });
  app.post('/api/clusters/:id/resolve', async (req, res) => {
    const action = req.body?.action === 'reject' ? 'reject' : 'approve';
    const r = await store.transact(t => resolveCluster(t, req.params.id, action, 'user'));
    res.status(r.ok ? 200 : 404).json({ data: r, error: r.ok ? null : { message: r.message, code: 'NOT_FOUND', details: '', hint: '' } });
  });

  // Ingest one document. Body: { filename, mimeType?, dataBase64? | text?, source? }
  const SOURCES: IngestSource[] = ['ui', 'inbox', 'api', 'email', 'test'];
  app.post('/api/ingest', async (req, res) => {
    const b = req.body ?? {};
    if (!b.filename || (!b.dataBase64 && !b.text)) {
      res.status(400).json({ data: null, error: { message: 'Provide filename and either dataBase64 or text', code: 'BAD_REQUEST', details: '', hint: '' } });
      return;
    }
    const source = SOURCES.includes(b.source) ? b.source : 'api';
    const r = await ingestDocument(store, { filename: String(b.filename), mimeType: b.mimeType, dataBase64: b.dataBase64, text: b.text }, { provider, source });
    res.json({ data: r, error: null });
  });

  // Which extraction engine is active (shown in the UI header).
  app.get('/api/llm/status', (_req, res) => {
    res.json({ data: { provider: provider.name, reason: providerReason, live: provider.name === 'gemini' }, error: null });
  });

  // One tiny round-trip to prove the key/model work.
  app.post('/api/llm/test', async (_req, res) => {
    try {
      const r = await provider.extract({ filename: 'ping.txt', text: 'From: a@b.com\nSubject: Invoice INV-PING for PO-1\nInvoice INV-PING total amount due $10.00', attachments: [] });
      res.json({ data: { ok: true, provider: provider.name, model: r.model ?? null }, error: null });
    } catch (e: any) {
      res.json({ data: { ok: false, provider: provider.name }, error: { message: String(e?.message ?? e).slice(0, 400), code: 'LLM', details: '', hint: '' } });
    }
  });

  // Full dump, handy for debugging and tests.
  app.get('/api/snapshot', (_req, res) => {
    res.json(store.snapshot());
  });

  return app;
}
