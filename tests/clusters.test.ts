import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/store';
import { runMatch } from '../server/matchService';
import { buildClusters, resolveCluster } from '../server/clusters';

let store: JsonStore;
beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clusters-'));
  store = new JsonStore(path.join(tmp, 'db.json'), path.join(__dirname, '..', 'data', 'seed.json'));
});

describe('computed intelligence clusters', () => {
  it('are not seeded: before matching only held-for-review documents can appear', async () => {
    expect((await store.snapshot?.() ?? (await store.transact(t => t))).documentclusters).toEqual([]);
    const ids = (await store.transact(t => buildClusters(t))).map(c => c.id);
    expect(ids.every(i => i === 'REVIEW')).toBe(true);
  });

  it('group the open seed exceptions by cause with real totals', async () => {
    await runMatch(store, { all: true });
    const cl = await store.transact(t => buildClusters(t));
    const exceptions = await store.transact(t => t.vendorinvoices.filter(i => i.match_status === 'Exception'));
    expect(cl.filter(c => c.id !== 'REVIEW').reduce((s, c) => s + c.document_count, 0)).toBe(exceptions.length);
    expect(exceptions.length).toBe(5);
    for (const c of cl) {
      expect(c.total_impact_amount).toBeCloseTo(c.docs.reduce((s, d) => s + d.amount, 0), 2);
      expect(c.docs.length).toBe(c.document_count);
    }
    expect(cl.map(c => c.id).sort()).toEqual(expect.arrayContaining(['FREIGHT', 'DUPLICATE']));
  });

  it('approving a cluster pays its invoices and removes it (and is sticky)', async () => {
    await runMatch(store, { all: true });
    const before = await store.transact(t => buildClusters(t));
    const target = before[0];
    const r = await store.transact(t => resolveCluster(t, target.id, 'approve'));
    expect(r.ok).toBe(true);
    expect(r.count).toBe(target.document_count);
    const after = await store.transact(t => buildClusters(t));
    expect(after.find(c => c.id === target.id)).toBeUndefined();
    await runMatch(store, { all: true }); // re-running the engine must not resurrect it
    expect((await store.transact(t => buildClusters(t))).find(c => c.id === target.id)).toBeUndefined();
  });

  it('rejecting routes to the vendor, removes the cluster and logs it', async () => {
    await runMatch(store, { all: true });
    const target = (await store.transact(t => buildClusters(t)))[0];
    await store.transact(t => resolveCluster(t, target.id, 'reject'));
    expect((await store.transact(t => buildClusters(t))).find(c => c.id === target.id)).toBeUndefined();
    const logs = await store.transact(t => t.auditlogs.filter(l => l.action_type === 'Reject to Vendor'));
    expect(logs.length).toBe(target.document_count);
  });

  it('unknown cluster is a clean not-found', async () => {
    const r = await store.transact(t => resolveCluster(t, 'NOPE', 'approve'));
    expect(r.ok).toBe(false);
  });
});
