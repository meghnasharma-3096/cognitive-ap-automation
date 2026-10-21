/**
 * THE three-way-match engine. Pure functions only (no I/O) so it can be tested
 * exhaustively and reused by the API, batch runs and the ingestion pipeline.
 *
 * Rules, in precedence order (first failing rule is the "primary" reason; all
 * failures are reported):
 *
 *   DUPLICATE        same invoice number already filed earlier (number alone, vendor ignored)
 *   PO_MISSING       invoice references no PO / PO not in ERP
 *   RECEIPT_MISSING  no warehouse receipt for the PO
 *   VENDOR_MISMATCH  invoice vendor differs from PO vendor (only when both known)
 *   QTY_VS_RECEIPT   billed quantity > received quantity
 *   QTY_VS_PO        billed quantity > ordered quantity
 *   PRICE            |goods total - PO expected price| > tolerance   (goods = total - freight)
 *   FREIGHT          |invoice freight - PO authorised freight| > tolerance
 *   TOTAL_MISSING    cannot determine the invoice amount
 *
 * A rule that cannot be evaluated because the data is absent (e.g. the invoice
 * does not state a quantity) is reported as "skipped", never silently treated as 0.
 */

export interface MatchConfig {
  /** Dollar tolerance for price and freight variance (PRD: $5, configurable). */
  tolerance: number;
}

export const DEFAULT_CONFIG: MatchConfig = {
  tolerance: Number(process.env.AP_TOLERANCE ?? 5),
};

export interface InvoiceInput {
  invoice_number: string;
  po_number?: string | null;
  vendor_name?: string | null;
  billed_quantity?: number | null;
  unit_price?: number | null;
  freight_amount?: number | null;
  total_amount?: number | null;
}

export interface PurchaseOrderInput {
  po_number: string;
  vendor_name?: string | null;
  expected_quantity?: number | null;
  unit_price?: number | null;
  expected_price?: number | null;
  freight_amount?: number | null;
}

export interface ReceiptInput {
  po_number: string;
  received_quantity?: number | null;
}

export type CheckCode =
  | 'DUPLICATE' | 'PO_MISSING' | 'RECEIPT_MISSING' | 'VENDOR_MISMATCH'
  | 'QTY_VS_RECEIPT' | 'QTY_VS_PO' | 'PRICE' | 'FREIGHT' | 'TOTAL_MISSING';

export interface Check {
  code: CheckCode;
  label: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
}

export interface Decision {
  status: 'Success' | 'Exception';
  primaryCode: CheckCode | null;
  /** Short human reason for the primary failure ('' on success). */
  reason: string;
  /** All failure details joined, for report notes. */
  notes: string;
  checks: Check[];
  amounts: { total: number | null; goods: number | null; freight: number; priceVariance: number | null; freightVariance: number | null };
}

export interface MatchContext {
  po?: PurchaseOrderInput | null;
  receipt?: ReceiptInput | null;
  /** The earlier invoice that already used this invoice number, if any. */
  duplicateOf?: { invoice_number: string; po_number?: string | null; vendor_name?: string | null } | null;
}

// ------------------------------------------------------------ normalisation

export const normInvoiceNo = (s?: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "po 4017", "PO4017", "po-4017" -> "PO-4017". Anything else is just trimmed/uppercased. */
export function normPo(s?: string | null): string {
  const t = (s ?? '').toUpperCase().trim().replace(/\s+/g, '');
  const m = t.match(/^PO-?(.+)$/);
  return m ? `PO-${m[1]}` : t;
}

const VENDOR_NOISE = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co|gmbh|plc|pvt|private)\b/g;
export const normVendor = (s?: string | null) =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(VENDOR_NOISE, ' ').replace(/\s+/g, ' ').trim();

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// ------------------------------------------------------------------- engine

export function evaluateInvoice(inv: InvoiceInput, ctx: MatchContext, cfg: MatchConfig = DEFAULT_CONFIG): Decision {
  const checks: Check[] = [];
  const push = (code: CheckCode, label: string, status: Check['status'], detail: string) =>
    checks.push({ code, label, status, detail });
  const tolC = cents(cfg.tolerance);

  const { po, receipt, duplicateOf } = ctx;

  // 1. Duplicate
  if (duplicateOf) {
    const where = [duplicateOf.po_number, duplicateOf.vendor_name].filter(Boolean).join(' / ');
    push('DUPLICATE', 'Duplicate invoice', 'fail',
      `Invoice number ${inv.invoice_number} was already filed${where ? ` (${where})` : ''}`);
  } else {
    push('DUPLICATE', 'Duplicate invoice', 'pass', 'Invoice number not seen before');
  }

  // 2. PO present
  if (!inv.po_number) {
    push('PO_MISSING', 'Purchase order', 'fail', 'Invoice does not reference a PO number');
  } else if (!po) {
    push('PO_MISSING', 'Purchase order', 'fail', `${normPo(inv.po_number)} not found in ERP`);
  } else {
    push('PO_MISSING', 'Purchase order', 'pass', `${po.po_number} found`);
  }

  // 3. Receipt present
  if (!po) {
    push('RECEIPT_MISSING', 'Goods receipt', 'skipped', 'No PO to match a receipt against');
  } else if (!receipt) {
    push('RECEIPT_MISSING', 'Goods receipt', 'fail', `No warehouse receipt for ${po.po_number}`);
  } else {
    push('RECEIPT_MISSING', 'Goods receipt', 'pass', `Received ${receipt.received_quantity ?? '?'} units`);
  }

  // 4. Vendor
  const invVendor = normVendor(inv.vendor_name);
  const poVendor = normVendor(po?.vendor_name);
  if (!po || !invVendor || !poVendor) {
    push('VENDOR_MISMATCH', 'Vendor identity', 'skipped', 'Vendor not stated on invoice or PO');
  } else if (invVendor === poVendor || invVendor.includes(poVendor) || poVendor.includes(invVendor)) {
    push('VENDOR_MISMATCH', 'Vendor identity', 'pass', `Vendor matches PO (${po.vendor_name})`);
  } else {
    push('VENDOR_MISMATCH', 'Vendor identity', 'fail', `Invoice vendor "${inv.vendor_name}" differs from PO vendor "${po.vendor_name}"`);
  }

  // 5/6. Quantities
  const billedQty = num(inv.billed_quantity);
  const receivedQty = num(receipt?.received_quantity);
  const orderedQty = num(po?.expected_quantity);

  if (billedQty === null) {
    push('QTY_VS_RECEIPT', 'Billed vs received qty', 'skipped', 'Invoice does not state a quantity');
    push('QTY_VS_PO', 'Billed vs ordered qty', 'skipped', 'Invoice does not state a quantity');
  } else {
    if (receivedQty === null) {
      push('QTY_VS_RECEIPT', 'Billed vs received qty', 'skipped', 'No received quantity on record');
    } else if (billedQty > receivedQty) {
      push('QTY_VS_RECEIPT', 'Billed vs received qty', 'fail', `Quantity mismatch: billed ${billedQty} > received ${receivedQty}`);
    } else {
      push('QTY_VS_RECEIPT', 'Billed vs received qty', 'pass', `Billed ${billedQty} <= received ${receivedQty}`);
    }
    if (orderedQty === null) {
      push('QTY_VS_PO', 'Billed vs ordered qty', 'skipped', 'No ordered quantity on PO');
    } else if (billedQty > orderedQty) {
      push('QTY_VS_PO', 'Billed vs ordered qty', 'fail', `Over-billed: billed ${billedQty} > ordered ${orderedQty}`);
    } else {
      push('QTY_VS_PO', 'Billed vs ordered qty', 'pass', `Billed ${billedQty} <= ordered ${orderedQty}`);
    }
  }

  // Amounts
  const freight = num(inv.freight_amount) ?? 0;
  let total = num(inv.total_amount);
  if (total === null) {
    const q = num(inv.billed_quantity), u = num(inv.unit_price);
    if (q !== null && u !== null) total = (cents(q * u) + cents(freight)) / 100;
  }
  const goods = total === null ? null : (cents(total) - cents(freight)) / 100;

  const poExpected = po
    ? num(po.expected_price) ?? (num(po.expected_quantity) !== null && num(po.unit_price) !== null
        ? cents(num(po.expected_quantity)! * num(po.unit_price)!) / 100 : null)
    : null;

  let priceVariance: number | null = null;
  let freightVariance: number | null = null;

  // 7. Price
  if (total === null) {
    push('TOTAL_MISSING', 'Invoice amount', 'fail', 'Could not determine the invoice total');
    push('PRICE', 'Price vs PO', 'skipped', 'No invoice total');
  } else {
    push('TOTAL_MISSING', 'Invoice amount', 'pass', `Total ${money(total)}`);
    if (poExpected === null) {
      push('PRICE', 'Price vs PO', 'skipped', 'No expected price on PO');
    } else {
      priceVariance = Math.abs(cents(goods!) - cents(poExpected)) / 100;
      if (Math.abs(cents(goods!) - cents(poExpected)) > tolC) {
        push('PRICE', 'Price vs PO', 'fail',
          `Price variance ${money(priceVariance)} exceeds ${money(cfg.tolerance)} (billed goods ${money(goods!)} vs PO ${money(poExpected)})`);
      } else {
        push('PRICE', 'Price vs PO', 'pass', `Within tolerance (${money(priceVariance)})`);
      }
    }
  }

  // 8. Freight
  if (!po) {
    push('FREIGHT', 'Freight vs PO', 'skipped', 'No PO to compare freight against');
  } else {
    const poFreight = num(po.freight_amount) ?? 0;
    freightVariance = Math.abs(cents(freight) - cents(poFreight)) / 100;
    if (Math.abs(cents(freight) - cents(poFreight)) > tolC) {
      push('FREIGHT', 'Freight vs PO', 'fail',
        poFreight === 0
          ? `Unapproved freight ${money(freight)} (PO authorises none)`
          : `Freight variance ${money(freightVariance)} exceeds ${money(cfg.tolerance)} (billed ${money(freight)}, PO ${money(poFreight)})`);
    } else {
      push('FREIGHT', 'Freight vs PO', 'pass', freight === 0 && poFreight === 0 ? 'No freight billed' : `Freight ${money(freight)} within tolerance of PO`);
    }
  }

  const failures = checks.filter(c => c.status === 'fail');
  const order: CheckCode[] = ['DUPLICATE', 'PO_MISSING', 'RECEIPT_MISSING', 'VENDOR_MISMATCH', 'QTY_VS_RECEIPT', 'QTY_VS_PO', 'PRICE', 'FREIGHT', 'TOTAL_MISSING'];
  const primary = failures.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))[0] ?? null;

  return {
    status: failures.length === 0 ? 'Success' : 'Exception',
    primaryCode: primary?.code ?? null,
    reason: primary?.detail ?? '',
    notes: failures.map(f => f.detail).join('; '),
    checks,
    amounts: { total, goods, freight, priceVariance, freightVariance },
  };
}

/** Index of the first invoice (table order) for each normalised invoice number. */
export function findDuplicateOf<T extends { invoice_number: string }>(invoices: T[], index: number): T | null {
  const key = normInvoiceNo(invoices[index].invoice_number);
  if (!key) return null;
  for (let j = 0; j < index; j++) if (normInvoiceNo(invoices[j].invoice_number) === key) return invoices[j];
  return null;
}
