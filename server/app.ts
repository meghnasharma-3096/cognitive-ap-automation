import express from 'express';
import type { Express } from 'express';
import { JsonStore } from './store';
import type { Query } from './store';
import { approveInvoice, runMatch } from './matchService';

export interface AppDeps {
  store: JsonStore;
}

/** API-only Express app (no Vite). Tests mount this directly. */
export function createApp({ store }: AppDeps): Express {
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

  // Full dump, handy for debugging and tests.
  app.get('/api/snapshot', (_req, res) => {
    res.json(store.snapshot());
  });

  return app;
}
