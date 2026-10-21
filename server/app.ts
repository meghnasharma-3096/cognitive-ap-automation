import express from 'express';
import type { Express } from 'express';
import { JsonStore } from './store';
import type { Query } from './store';

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

  // Full dump, handy for debugging and tests.
  app.get('/api/snapshot', (_req, res) => {
    res.json(store.snapshot());
  });

  return app;
}
