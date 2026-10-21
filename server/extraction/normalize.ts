/**
 * Turns whatever the LLM (or fallback parser) returned into a well-typed
 * Extraction, then audits it deterministically: arithmetic cross-checks and
 * "is this value actually in the document?" verification. The LLM reads; this
 * layer decides how much to trust it.
 */
import { normInvoiceNo, normPo } from '../matchEngine';
import { EVIDENCE_FIELDS } from './schema';
import type { AckStatus, DocType, Extraction, LineItem } from './schema';

export interface Audit {
  extraction: Extraction;
  /** Confidence after deterministic penalties (0..1). */
  confidence: number;
  warnings: string[];
  /** Fields whose value was found verbatim in the source text. */
  verified: string[];
  /** Whether source text was available to verify against (false for pure images). */
  verifiable: boolean;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || /^(null|n\/a|none|unknown)$/i.test(s) ? null : s;
};

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[A-Za-z$€£¥₹\s]/g, '');
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()\-]/g, '');
  // 1.234,56 (EU) vs 1,234.56 (US)
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const DOC_TYPES: DocType[] = ['invoice', 'acknowledgement', 'inquiry', 'other'];
const ACK: Record<string, AckStatus> = {
  confirmed: 'Confirmed', confirm: 'Confirmed', delayed: 'Delayed', delay: 'Delayed',
  backorder: 'Backorder', backordered: 'Backorder', split: 'Split Shipment', 'split shipment': 'Split Shipment',
  'price change': 'Price Change',
};

function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function coerce(raw: any): Extraction {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = String(r.document_type ?? '').toLowerCase() as DocType;
  const items: LineItem[] = Array.isArray(r.line_items)
    ? r.line_items.map((li: any) => ({
        description: str(li?.description), sku: str(li?.sku),
        quantity: toNumber(li?.quantity), unit_price: toNumber(li?.unit_price), amount: toNumber(li?.amount),
      }))
    : [];
  const ackRaw = r.acknowledgement && typeof r.acknowledgement === 'object' ? r.acknowledgement : null;
  const ackStatus = ackRaw?.status ? ACK[String(ackRaw.status).toLowerCase().trim()] ?? null : null;

  return {
    document_type: DOC_TYPES.includes(type) ? type : 'other',
    confidence: Math.min(1, Math.max(0, toNumber(r.confidence) ?? 0)),
    vendor_name: str(r.vendor_name),
    sender_email: str(r.sender_email)?.toLowerCase() ?? null,
    invoice_number: str(r.invoice_number),
    invoice_date: isoDate(r.invoice_date),
    po_number: str(r.po_number) ? normPo(str(r.po_number)) : null,
    other_po_numbers: Array.isArray(r.other_po_numbers) ? r.other_po_numbers.map((p: any) => normPo(str(p))).filter(Boolean) : [],
    currency: str(r.currency)?.toUpperCase() ?? null,
    line_items: items,
    subtotal: toNumber(r.subtotal),
    freight_amount: toNumber(r.freight_amount),
    tax_amount: toNumber(r.tax_amount),
    total_amount: toNumber(r.total_amount),
    payment_terms: str(r.payment_terms),
    acknowledgement: ackRaw
      ? { status: ackStatus, quantity: toNumber(ackRaw.quantity), eta: isoDate(ackRaw.eta), new_unit_price: toNumber(ackRaw.new_unit_price) }
      : null,
    summary: str(r.summary),
    evidence: Array.isArray(r.evidence)
      ? r.evidence.map((e: any) => ({ field: String(e?.field ?? ''), quote: String(e?.quote ?? '') })).filter((e: any) => e.field && e.quote)
      : [],
  };
}

// ----------------------------------------------------------- verification

const squash = (s: string) => s.toLowerCase().replace(/[\s ]+/g, ' ');

/** Does a monetary value appear in the text in any common formatting? */
export function numberInText(n: number, text: string): boolean {
  const t = text.replace(/[\s ]/g, '');
  const fixed = n.toFixed(2);
  const [int, dec] = fixed.split('.');
  const withCommas = Number(int).toLocaleString('en-US') + '.' + dec;
  const candidates = new Set([fixed, withCommas, String(n)]);
  if (dec === '00') { candidates.add(int); candidates.add(Number(int).toLocaleString('en-US')); }
  for (const c of candidates) {
    // must not be glued to other digits (e.g. 45 inside 1945)
    const re = new RegExp(`(^|[^0-9.,])${c.replace(/[.,]/g, m => '\\' + m)}(?![0-9])`);
    if (re.test(t)) return true;
  }
  return false;
}

export function audit(ext: Extraction, sourceText: string, opts: { llmConfidence?: boolean } = {}): Audit {
  const warnings: string[] = [];
  const verified: string[] = [];
  let conf = ext.confidence;
  const hasText = sourceText.trim().length >= 20;

  // Derive amounts we can compute, never overwrite stated ones.
  const itemSum = ext.line_items.length && ext.line_items.every(l => l.amount !== null)
    ? Math.round(ext.line_items.reduce((s, l) => s + (l.amount ?? 0), 0) * 100) / 100 : null;
  if (ext.subtotal === null && itemSum !== null) ext.subtotal = itemSum;
  if (ext.total_amount === null && ext.subtotal !== null) {
    ext.total_amount = Math.round((ext.subtotal + (ext.freight_amount ?? 0) + (ext.tax_amount ?? 0)) * 100) / 100;
    warnings.push('Total was not stated; derived from subtotal + freight + tax');
    conf -= 0.1;
  }

  // Arithmetic consistency: parts should add up to the total.
  if (ext.total_amount !== null && ext.subtotal !== null) {
    const expect = ext.subtotal + (ext.freight_amount ?? 0) + (ext.tax_amount ?? 0);
    if (Math.abs(expect - ext.total_amount) > 0.05) {
      warnings.push(`Amounts do not add up: subtotal+freight+tax = ${expect.toFixed(2)} but total = ${ext.total_amount.toFixed(2)}`);
      conf -= 0.15;
    }
  }
  if (ext.other_po_numbers.length > 0 && ext.po_number) {
    warnings.push(`Multiple PO numbers referenced: using ${ext.po_number}, also saw ${ext.other_po_numbers.join(', ')}`);
    conf -= 0.1;
  }
  if (ext.currency && ext.currency !== 'USD') {
    warnings.push(`Invoice currency is ${ext.currency}, not USD`);
    conf -= 0.1;
  }

  // Grounding: is each key value really in the document?
  if (hasText) {
    const hay = squash(sourceText);
    const flat = sourceText;
    for (const field of EVIDENCE_FIELDS) {
      const value = (ext as any)[field];
      if (value === null || value === undefined) continue;
      // "No freight" is an absence, not a quotable number: a zero can't be grounded, so don't penalise it.
      if (value === 0) continue;
      let ok: boolean;
      if (typeof value === 'number') ok = numberInText(value, flat);
      else if (field === 'invoice_number') ok = squash(flat).includes(squash(value)) || normInvoiceNo(flat).includes(normInvoiceNo(value));
      else ok = hay.replace(/[-\s]/g, '').includes(String(value).toLowerCase().replace(/[-\s]/g, ''));
      if (ok) verified.push(field);
      else { warnings.push(`${field} "${value}" was not found in the source document`); conf -= 0.25; }
    }
    // Quoted evidence must itself be verbatim.
    for (const e of ext.evidence) {
      if (!hay.includes(squash(e.quote).trim())) warnings.push(`Evidence quote for ${e.field} is not verbatim in the document`);
    }
  } else if (opts.llmConfidence !== false) {
    warnings.push('No machine-readable text (scan/image): values could not be verified against the source');
  }

  return { extraction: ext, confidence: Math.min(1, Math.max(0, conf)), warnings, verified, verifiable: hasText };
}
