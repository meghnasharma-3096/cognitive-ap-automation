import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateInvoice, findDuplicateOf, normInvoiceNo, normPo, normVendor } from '../server/matchEngine';
import type { InvoiceInput, PurchaseOrderInput, ReceiptInput } from '../server/matchEngine';
import { JsonStore } from '../server/store';
import { approveInvoice, runMatch } from '../server/matchService';

const cfg = { tolerance: 5 };
const po = (o: Partial<PurchaseOrderInput> = {}): PurchaseOrderInput => ({
  po_number: 'PO-1', vendor_name: 'Acme Inc', expected_quantity: 100, unit_price: 10, expected_price: 1000, freight_amount: 0, ...o,
});
const rc = (q = 100): ReceiptInput => ({ po_number: 'PO-1', received_quantity: q });
const inv = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({
  invoice_number: 'INV-1', po_number: 'PO-1', vendor_name: 'Acme Inc', billed_quantity: 100, unit_price: 10, freight_amount: 0, total_amount: 1000, ...o,
});
const run = (i: InvoiceInput, p: PurchaseOrderInput | null = po(), r: ReceiptInput | null = rc(), dup: any = null) =>
  evaluateInvoice(i, { po: p, receipt: r, duplicateOf: dup }, cfg);

describe('normalisation', () => {
  it('invoice numbers ignore case, spaces and punctuation', () => {
    expect(normInvoiceNo('INV-88392')).toBe(normInvoiceNo(' inv 88392 '));
    expect(normInvoiceNo('inv_88392')).toBe('INV88392');
  });
  it('PO numbers canonicalise', () => {
    expect(normPo('po 4017')).toBe('PO-4017');
    expect(normPo('PO4017')).toBe('PO-4017');
    expect(normPo('PO-2024-100')).toBe('PO-2024-100');
    expect(normPo(null)).toBe('');
  });
  it('vendor names ignore legal suffixes and punctuation', () => {
    expect(normVendor('XYZ Company')).toBe(normVendor('XYZ Co.'));
    expect(normVendor('Acme, Inc.')).toBe('acme');
  });
});

describe('engine: single rules', () => {
  it('clean invoice passes with every check pass/skipped', () => {
    const d = run(inv());
    expect(d.status).toBe('Success');
    expect(d.checks.every(c => c.status !== 'fail')).toBe(true);
    expect(d.reason).toBe('');
  });

  it('price: exactly at tolerance passes, one cent over fails', () => {
    expect(run(inv({ total_amount: 1005 })).status).toBe('Success');
    expect(run(inv({ total_amount: 995 })).status).toBe('Success');
    const over = run(inv({ total_amount: 1005.01 }));
    expect(over.status).toBe('Exception');
    expect(over.primaryCode).toBe('PRICE');
  });

  it('price compares goods (total minus freight), not the raw total', () => {
    const d = run(inv({ total_amount: 1045, freight_amount: 45 }), po({ freight_amount: 45 }));
    expect(d.amounts.goods).toBe(1000);
    expect(d.status).toBe('Success');
  });

  it('freight: unapproved freight is flagged specifically', () => {
    const d = run(inv({ total_amount: 1045, freight_amount: 45 }));
    expect(d.status).toBe('Exception');
    expect(d.primaryCode).toBe('FREIGHT');
    expect(d.reason).toMatch(/Unapproved freight \$45\.00/);
  });

  it('freight: authorised freight within tolerance passes', () => {
    expect(run(inv({ total_amount: 1012.5, freight_amount: 12.5 }), po({ freight_amount: 12.5 })).status).toBe('Success');
    expect(run(inv({ total_amount: 1015, freight_amount: 15 }), po({ freight_amount: 12.5 })).status).toBe('Success');
    expect(run(inv({ total_amount: 1020, freight_amount: 20 }), po({ freight_amount: 12.5 })).primaryCode).toBe('FREIGHT');
  });

  it('quantity: billed > received fails; billed < received passes', () => {
    expect(run(inv(), po(), rc(95)).primaryCode).toBe('QTY_VS_RECEIPT');
    expect(run(inv({ billed_quantity: 95, total_amount: 1000 }), po(), rc(100)).status).toBe('Success');
  });

  it('quantity: billed > ordered fails even if warehouse received extra', () => {
    const d = run(inv({ billed_quantity: 102 }), po(), rc(102));
    expect(d.checks.find(c => c.code === 'QTY_VS_PO')!.status).toBe('fail');
  });

  it('over-delivery alone (received > ordered, billed = ordered) passes', () => {
    expect(run(inv(), po(), rc(102)).status).toBe('Success');
  });

  it('missing PO / receipt', () => {
    expect(run(inv(), null, null).primaryCode).toBe('PO_MISSING');
    expect(run(inv(), po(), null).primaryCode).toBe('RECEIPT_MISSING');
    expect(run(inv({ po_number: null }), null, null).reason).toMatch(/does not reference a PO/);
  });

  it('vendor mismatch is flagged; suffix differences are not', () => {
    expect(run(inv({ vendor_name: 'Totally Different Ltd' })).primaryCode).toBe('VENDOR_MISMATCH');
    expect(run(inv({ vendor_name: 'ACME INCORPORATED' })).status).toBe('Success');
    expect(run(inv({ vendor_name: null })).checks.find(c => c.code === 'VENDOR_MISMATCH')!.status).toBe('skipped');
  });

  it('duplicate invoice number fails and names the original', () => {
    const d = run(inv(), po(), rc(), { invoice_number: 'INV-1', po_number: 'PO-9', vendor_name: 'Other Co' });
    expect(d.status).toBe('Exception');
    expect(d.primaryCode).toBe('DUPLICATE');
    expect(d.reason).toMatch(/already filed \(PO-9 \/ Other Co\)/);
  });
});

describe('engine: missing / sloppy data (LLM output is imperfect)', () => {
  it('missing quantity is SKIPPED, not treated as 0 or as a failure', () => {
    const d = run(inv({ billed_quantity: null, unit_price: null }));
    expect(d.status).toBe('Success');
    expect(d.checks.find(c => c.code === 'QTY_VS_RECEIPT')!.status).toBe('skipped');
  });

  it('missing total but qty*unit available: computes total incl. freight', () => {
    const d = run(inv({ total_amount: null, freight_amount: 0 }));
    expect(d.amounts.total).toBe(1000);
    expect(d.status).toBe('Success');
  });

  it('no total at all is an explicit exception', () => {
    const d = run(inv({ total_amount: null, billed_quantity: null, unit_price: null }));
    expect(d.status).toBe('Exception');
    expect(d.primaryCode).toBe('TOTAL_MISSING');
  });

  it('numeric strings are coerced', () => {
    expect(run(inv({ total_amount: '1000.00' as any, billed_quantity: '100' as any })).status).toBe('Success');
  });

  it('float noise does not trip the tolerance (cent arithmetic)', () => {
    expect(run(inv({ total_amount: 0.1 + 0.2 + 999.7 })).status).toBe('Success');
  });

  it('multiple failures: all reported, primary follows precedence', () => {
    const d = run(inv({ billed_quantity: 120, total_amount: 1245, freight_amount: 45 }), po(), rc(100), { invoice_number: 'INV-1' });
    expect(d.primaryCode).toBe('DUPLICATE');
    expect(d.checks.filter(c => c.status === 'fail').map(c => c.code)).toEqual(
      expect.arrayContaining(['DUPLICATE', 'QTY_VS_RECEIPT', 'QTY_VS_PO', 'PRICE', 'FREIGHT']));
    expect(d.notes.split('; ').length).toBeGreaterThanOrEqual(5);
  });

  it('custom tolerance is honoured', () => {
    const d = evaluateInvoice(inv({ total_amount: 1020 }), { po: po(), receipt: rc() }, { tolerance: 25 });
    expect(d.status).toBe('Success');
  });
});

describe('findDuplicateOf', () => {
  const list = [{ invoice_number: 'INV-1' }, { invoice_number: 'INV-2' }, { invoice_number: 'inv 1' }, { invoice_number: 'INV-1' }];
  it('first occurrence is the original, later ones are duplicates', () => {
    expect(findDuplicateOf(list, 0)).toBeNull();
    expect(findDuplicateOf(list, 1)).toBeNull();
    expect(findDuplicateOf(list, 2)).toBe(list[0]);
    expect(findDuplicateOf(list, 3)).toBe(list[0]);
  });
});

// ------------------------------------------------------------- against seed

describe('seed dataset: every invoice has a known outcome', () => {
  let store: JsonStore;
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-match-'));
    store = new JsonStore(path.join(tmp, 'db.json'), path.join(__dirname, '..', 'data', 'seed.json'));
  });

  const expected: Record<string, [string, string | null]> = {
    'inv-300': ['Success', null], 'inv-301': ['Success', null], 'inv-302': ['Success', null],
    'inv-303': ['Exception', 'QTY_VS_RECEIPT'],
    'inv-304': ['Success', null],
    'inv-305': ['Exception', 'FREIGHT'],
    'inv-306': ['Success', null],
    'inv-307': ['Success', null],
    'inv-308': ['Success', null], 'inv-309': ['Success', null],
    'inv-310': ['Exception', 'QTY_VS_RECEIPT'],
    'inv-311': ['Success', null],
    'inv-312': ['Exception', 'PRICE'],
    'inv-313': ['Success', null],
    'inv-314': ['Exception', 'DUPLICATE'],
  };

  it('batch run produces exactly the documented verdicts', async () => {
    const summary = await runMatch(store);
    expect(summary.processed).toBe(15);
    expect(summary.success).toBe(10);
    expect(summary.exceptions).toBe(5);
    for (const r of summary.results) {
      expect([r.status, r.code], r.id).toEqual(expected[r.id]);
    }
  });

  it('reports mirror verdicts and carry the vendor', async () => {
    await runMatch(store);
    const s = store.snapshot();
    expect(s.successreports).toHaveLength(10);
    expect(s.exceptionreports).toHaveLength(5);
    expect(s.successreports.every(r => r.vendor && r.vendor !== 'Unknown' && r.amount > 0)).toBe(true);
    expect(s.exceptionreports.find(r => r.invoice_number === 'INV-2024-305')!.notes).toMatch(/Unapproved freight \$45\.00/);
  });

  it('is idempotent: running again (or concurrently) never duplicates reports', async () => {
    await Promise.all([runMatch(store), runMatch(store), runMatch(store, { all: true })]);
    await runMatch(store, { all: true });
    const s = store.snapshot();
    expect(s.successreports).toHaveLength(10);
    expect(s.exceptionreports).toHaveLength(5);
    expect(s.vendorinvoices.filter(i => i.match_status === 'Pending')).toHaveLength(0);
  });

  it('default run only touches Pending invoices', async () => {
    await runMatch(store);
    const again = await runMatch(store);
    expect(again.processed).toBe(0);
  });

  it('re-evaluating a single invoice after the data is fixed flips its verdict', async () => {
    await runMatch(store);
    // Warehouse corrects the short receipt for PO-2024-103
    await store.run({ table: 'warehousereceipts', op: 'update', values: { received_quantity: 130 }, filters: [{ op: 'eq', col: 'po_number', val: 'PO-2024-103' }] });
    const id = store.snapshot().vendorinvoices.find(i => i.id === 'inv-303')!.id;
    const r = await runMatch(store, { invoiceIds: [id] });
    expect(r.results[0].status).toBe('Success');
    const s = store.snapshot();
    expect(s.successreports).toHaveLength(11);
    expect(s.exceptionreports).toHaveLength(4);
  });

  it('manual approval moves the invoice to success, keeps the reason, and survives re-runs', async () => {
    await runMatch(store);
    const r = await approveInvoice(store, 'inv-305');
    expect(r.ok).toBe(true);
    let s = store.snapshot();
    expect(s.exceptionreports.some(x => x.invoice_id === 'inv-305')).toBe(false);
    const rep = s.successreports.find(x => x.invoice_id === 'inv-305')!;
    expect(rep.status).toBe('Manually Approved');
    expect(rep.notes).toMatch(/was: Unapproved freight/);
    await runMatch(store, { all: true });
    await runMatch(store, { invoiceIds: ['inv-305'] });
    s = store.snapshot();
    expect(s.vendorinvoices.find(i => i.id === 'inv-305')!.match_status).toBe('Success');
    expect(s.successreports.filter(x => x.invoice_id === 'inv-305')).toHaveLength(1);
    expect((await approveInvoice(store, 'nope')).ok).toBe(false);
  });

  it('writes one audit log per evaluation', async () => {
    await runMatch(store);
    expect(store.snapshot().auditlogs.filter(a => a.action_type === 'MATCH')).toHaveLength(15);
  });
});

describe('seed: the two sample vendor-email PDFs', () => {
  const seedPo = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed.json'), 'utf8')).purchaseorders.find((p: any) => p.po_number === n);
  const seedRc = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed.json'), 'utf8')).warehousereceipts.find((p: any) => p.po_number === n);

  const xyz: InvoiceInput = { invoice_number: 'INV-88392', po_number: 'PO-4017', vendor_name: 'XYZ Company', total_amount: 1953.94, freight_amount: 45 };
  const efghi: InvoiceInput = { invoice_number: 'INV-88392', po_number: 'PO-4019', vendor_name: 'EFGHI Company', total_amount: 1953.94, freight_amount: 45 };

  it('XYZ (PO-4017): goods match the PO exactly, but the $45 freight is not on the PO', () => {
    const d = evaluateInvoice(xyz, { po: seedPo('PO-4017'), receipt: seedRc('PO-4017') }, cfg);
    expect(d.amounts.goods).toBe(1908.94);
    expect(d.checks.find(c => c.code === 'PRICE')!.status).toBe('pass');
    expect(d.checks.find(c => c.code === 'QTY_VS_RECEIPT')!.status).toBe('skipped');
    expect(d.status).toBe('Exception');
    expect(d.primaryCode).toBe('FREIGHT');
  });

  it('EFGHI (PO-4019) after XYZ: same invoice number is flagged as duplicate first', () => {
    const d = evaluateInvoice(efghi, { po: seedPo('PO-4019'), receipt: seedRc('PO-4019'), duplicateOf: xyz }, cfg);
    expect(d.primaryCode).toBe('DUPLICATE');
    expect(d.reason).toMatch(/PO-4017 \/ XYZ Company/);
  });

  it('with the freight pre-approved on the PO, XYZ passes (proves the rule, not a blanket fail)', () => {
    const d = evaluateInvoice(xyz, { po: { ...seedPo('PO-4017'), freight_amount: 45 }, receipt: seedRc('PO-4017') }, cfg);
    expect(d.status).toBe('Success');
  });
});
