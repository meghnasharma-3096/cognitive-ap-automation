import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { JsonStore } from '../server/store';

let server: Server;
let base = '';
let tmp = '';
let supabase: typeof import('../src/services/supabase').supabase;
let resetDatabase: typeof import('../src/services/supabase').resetDatabase;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-store-'));
  const store = new JsonStore(path.join(tmp, 'db.json'), path.join(__dirname, '..', 'data', 'seed.json'));
  server = createApp({ store }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The shim uses relative URLs (browser). Point them at the test server.
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (url: any, init?: any) =>
    realFetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init));

  ({ supabase, resetDatabase } = await import('../src/services/supabase'));
});

afterAll(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase();
});

describe('seed + reset', () => {
  it('seed loads with expected table sizes', async () => {
    const h = await (await fetch('/api/health')).json();
    expect(h.counts).toMatchObject({
      purchaseorders: 17, warehousereceipts: 17, vendorinvoices: 15,
      documentclusters: 3, ingesteddocuments: 0,
    });
  });

  it('reset restores deleted and modified data', async () => {
    await supabase.from('vendorinvoices').delete().not('id', 'is', null);
    await supabase.from('purchaseorders').update({ vendor_name: 'HACKED' }).eq('po_number', 'PO-2024-100');
    const mid = await supabase.from('vendorinvoices').select('*');
    expect(mid.data).toHaveLength(0);

    const r = await resetDatabase();
    expect(r.error).toBeNull();
    expect(r.data?.vendorinvoices).toBe(15);

    const po = await supabase.from('purchaseorders').select('*').eq('po_number', 'PO-2024-100').single();
    expect(po.data.vendor_name).toBe('Global Tech');
  });

  it('clear empties everything', async () => {
    await fetch('/api/clear', { method: 'POST' });
    const h = await (await fetch('/api/health')).json();
    expect(Object.values(h.counts).every(n => n === 0)).toBe(true);
  });
});

describe('query patterns used by the app', () => {
  it('select * returns all rows', async () => {
    const { data, error } = await supabase.from('purchaseorders').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(17);
  });

  it('.or("a.eq.X,a.eq.Y") — Matches screen filter', async () => {
    const { data } = await supabase.from('vendorinvoices').select('*').or('match_status.eq.Exception,match_status.eq.Pending');
    expect(data).toHaveLength(15); // all seeded invoices start Pending
    await supabase.from('vendorinvoices').update({ match_status: 'Success' }).eq('invoice_number', 'INV-2024-300');
    const after = await supabase.from('vendorinvoices').select('*').or('match_status.eq.Exception,match_status.eq.Pending');
    expect(after.data).toHaveLength(14);
  });

  it(".in('match_status', ['Pending', null]) matches Pending AND null — Batch Processing filter", async () => {
    await supabase.from('vendorinvoices').update({ match_status: null }).eq('invoice_number', 'INV-2024-301');
    await supabase.from('vendorinvoices').update({ match_status: 'Success' }).eq('invoice_number', 'INV-2024-302');
    const { data } = await supabase.from('vendorinvoices').select('*').in('match_status', ['Pending', null]);
    expect(data).toHaveLength(14); // 15 minus the Success one; the null one is included
    expect(data!.some((r: any) => r.invoice_number === 'INV-2024-301')).toBe(true);
  });

  it(".delete().not('id','is',null) clears a table", async () => {
    const r = await supabase.from('documentclusters').delete().not('id', 'is', null);
    expect(r.error).toBeNull();
    expect((await supabase.from('documentclusters').select('*')).data).toHaveLength(0);
  });

  it('insert().select().single() returns the created row with generated id', async () => {
    const { data, error } = await supabase.from('auditlogs')
      .insert({ action_type: 'X', document_id: 'd1', previous_status: 'a', new_status: 'b' })
      .select().single();
    expect(error).toBeNull();
    expect(data.id).toMatch(/[0-9a-f-]{36}/);
    expect(data.action_type).toBe('X');
  });

  it('insert array without select returns no data but persists', async () => {
    const r = await supabase.from('successreports').insert([{ invoice_number: 'A' }, { invoice_number: 'B' }]);
    expect(r.error).toBeNull();
    expect(r.data).toBeNull();
    expect((await supabase.from('successreports').select('*')).data).toHaveLength(2);
  });

  it('update().eq().select().single()', async () => {
    const po = (await supabase.from('purchaseorders').select('*').eq('po_number', 'PO-2024-103').single()).data;
    const { data } = await supabase.from('purchaseorders').update({ ack_status: 'Delayed' }).eq('id', po.id).select().single();
    expect(data.ack_status).toBe('Delayed');
  });

  it('maybeSingle returns null (not an error) when nothing matches', async () => {
    const r = await supabase.from('purchaseorders').select('*').eq('po_number', 'PO-NOPE').maybeSingle();
    expect(r.error).toBeNull();
    expect(r.data).toBeNull();
  });

  it('single errors when no row matches (PGRST116), like Supabase', async () => {
    const r = await supabase.from('purchaseorders').select('*').eq('po_number', 'PO-NOPE').single();
    expect(r.error?.code).toBe('PGRST116');
  });

  it('unknown table gives a clear error instead of silently returning nothing', async () => {
    const r = await supabase.from('purchaseOrders').select('*'); // wrong case on purpose
    expect(r.error?.code).toBe('42P01');
  });

  it('order, limit and column projection', async () => {
    const { data } = await supabase.from('purchaseorders').select('po_number,expected_quantity').order('expected_quantity', { ascending: false }).limit(2);
    expect(data).toHaveLength(2);
    expect(Object.keys(data![0]).sort()).toEqual(['expected_quantity', 'po_number']);
    expect(data![0].expected_quantity).toBeGreaterThanOrEqual(data![1].expected_quantity);
  });

  it('gt/lte/neq/ilike filters', async () => {
    expect((await supabase.from('purchaseorders').select('*').gt('expected_quantity', 230)).data!.length).toBeGreaterThan(0);
    expect((await supabase.from('purchaseorders').select('*').lte('expected_quantity', 100)).data!.length).toBeGreaterThan(0);
    expect((await supabase.from('purchaseorders').select('*').neq('vendor_name', 'Global Tech')).data!.every((r: any) => r.vendor_name !== 'Global Tech')).toBe(true);
    expect((await supabase.from('purchaseorders').select('*').ilike('vendor_name', 'global%')).data!.length).toBeGreaterThan(0);
  });
});

describe('robustness', () => {
  it('concurrent inserts never lose rows', async () => {
    await Promise.all(Array.from({ length: 40 }, (_, i) => supabase.from('auditlogs').insert({ action_type: `A${i}` })));
    expect((await supabase.from('auditlogs').select('*')).data).toHaveLength(40);
  });

  it('data persists on disk and survives a store restart', async () => {
    await supabase.from('auditlogs').insert({ action_type: 'persist-me' });
    const reopened = new JsonStore(path.join(tmp, 'db.json'), path.join(__dirname, '..', 'data', 'seed.json'));
    expect(reopened.snapshot().auditlogs.some((r: any) => r.action_type === 'persist-me')).toBe(true);
  });

  it('network failure surfaces as { error } not an exception', async () => {
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const r = await supabase.from('purchaseorders').select('*');
    expect(r.error?.code).toBe('NETWORK');
    vi.stubGlobal('fetch', real);
  });
});
