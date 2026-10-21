/**
 * The single ingestion pipeline. Every entry point (UI upload, pasted text,
 * inbox folder, POST /api/ingest, an .eml dropped in) ends up here:
 *
 *   prepare -> LLM extract (classify + extract in one call) -> deterministic audit
 *           -> persist document -> (invoice) file it and run the three-way match
 *                               -> (acknowledgement) update the PO
 */
import { randomUUID } from 'node:crypto';
import { prepareDocument } from './documents';
import type { RawDocument } from './documents';
import { audit, coerce } from './extraction/normalize';
import { RulesProvider } from './extraction/providers';
import type { Provider } from './extraction/providers';
import type { Extraction } from './extraction/schema';
import { applyMatch } from './matchService';
import { normPo } from './matchEngine';
import type { JsonStore, Row, Tables } from './store';

export type IngestSource = 'ui' | 'inbox' | 'api' | 'email' | 'test';

export interface IngestOptions {
  provider: Provider;
  /** Below this (after deterministic penalties) a human must review before anything is auto-matched. */
  minConfidence?: number;
  source?: IngestSource;
  /** Run the three-way match immediately for invoices (default true). */
  autoMatch?: boolean;
}

export interface IngestResult {
  ok: boolean;
  docId: string;
  intent: 'Invoice' | 'Acknowledgement' | 'Inquiry';
  status: 'Auto-posted' | 'Matched' | 'Needs Review';
  confidence: number;          // 0..100
  provider: string;            // gemini | rules | rules-fallback | fixture
  model?: string;
  summary: string | null;
  warnings: string[];
  extraction: Extraction | null;
  /** For invoices: the immediate three-way-match verdict, if it ran. */
  match: { status: string; reason: string; code: string | null } | null;
  invoiceId?: string;
  processingMs: number;
  error?: string;
}

const DEFAULT_MIN_CONFIDENCE = Number(process.env.AP_MIN_CONFIDENCE ?? 0.75);
const round1 = (n: number) => Math.round(n * 10) / 10;

const ACK_TO_UI: Record<string, string> = {
  Confirmed: 'Confirmed', Delayed: 'Delayed', Backorder: 'Backorder', 'Price Change': 'Price Change',
  'Split Shipment': 'Backorder', // the Acknowledgements screen has four buckets
};

function uniqueDocId(t: Tables, base: string): string {
  const taken = new Set(t.ingesteddocuments.map(d => d.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

interface PersistArgs {
  raw: RawDocument;
  ext: Extraction | null;
  confidence: number;
  warnings: string[];
  providerName: string;
  model?: string;
  needsReview: boolean;
  reviewReason: string | null;
  autoMatch: boolean;
  source: IngestSource;
  ms: number;
  error?: string;
}

function persist(t: Tables, a: PersistArgs): IngestResult {
  const now = new Date().toISOString();
  const ext = a.ext;
  const type = ext?.document_type ?? 'other';
  const intent: IngestResult['intent'] = type === 'invoice' ? 'Invoice' : type === 'acknowledgement' ? 'Acknowledgement' : 'Inquiry';

  let docId: string;
  let status: IngestResult['status'] = 'Needs Review';
  let match: IngestResult['match'] = null;
  let invoiceId: string | undefined;
  const warnings = [...a.warnings];

  if (type === 'invoice' && ext) {
    docId = uniqueDocId(t, ext.invoice_number ? ext.invoice_number.replace(/\s+/g, '') : `DOC-${t.ingesteddocuments.length + 1}`);
    if (!ext.invoice_number || ext.total_amount === null) {
      warnings.push('Invoice number or total could not be determined: not filed, needs a human');
    } else {
      const qtys = ext.line_items.map(l => l.quantity);
      const billedQty = qtys.length && qtys.every(q => q !== null) ? qtys.reduce((s, q) => s + (q as number), 0) : null;
      const unit = ext.line_items.length === 1 ? ext.line_items[0].unit_price : null;
      const row: Row = {
        id: randomUUID(), created_at: now,
        invoice_number: ext.invoice_number,
        po_number: ext.po_number,
        vendor_name: ext.vendor_name,
        billed_quantity: billedQty,
        unit_price: unit,
        freight_amount: ext.freight_amount ?? 0,
        total_amount: ext.total_amount,
        invoice_date: ext.invoice_date ?? now,
        match_status: a.needsReview ? 'Needs Review' : 'Pending',
        notes: a.needsReview ? `Needs review: ${a.reviewReason}` : '',
        source_doc_id: docId,
        sender_email: ext.sender_email,
        extraction_confidence: round1(a.confidence * 100),
      };
      t.vendorinvoices.push(row);
      invoiceId = row.id;
      if (!a.needsReview && a.autoMatch) {
        const r = applyMatch(t, { invoiceIds: [row.id], actor: 'ingest' }).results[0];
        match = { status: r.status, reason: r.reason, code: r.code };
        status = r.status === 'Success' ? 'Auto-posted' : 'Needs Review';
      }
    }
  } else if (type === 'acknowledgement' && ext) {
    docId = uniqueDocId(t, `ACK-${(ext.po_number ?? `${t.ingesteddocuments.length + 1}`).replace(/^PO-/, '')}`);
    const po = ext.po_number ? t.purchaseorders.find(p => normPo(p.po_number) === ext.po_number) : undefined;
    if (!po) {
      warnings.push(ext.po_number ? `${ext.po_number} not found in ERP` : 'No PO number on the acknowledgement');
    } else if (!a.needsReview) {
      const ack = ext.acknowledgement;
      po.ack_status = ACK_TO_UI[ack?.status ?? 'Confirmed'] ?? 'Confirmed';
      if (ack?.eta) po.expected_eta = `${ack.eta}T12:00:00.000Z`;
      if (ack?.new_unit_price != null) po.price_delta = Math.round((ack.new_unit_price - (po.unit_price ?? 0)) * 100) / 100;
      if (ack?.quantity != null) po.ack_quantity = ack.quantity;
      po.ack_note = ext.summary;
      t.auditlogs.push({
        id: randomUUID(), created_at: now, timestamp: now, action_type: 'ACK_APPLIED', document_id: docId,
        previous_status: 'Pending', new_status: po.ack_status, actor: 'ingest', detail: ext.summary ?? '',
      });
      status = 'Matched';
    }
  } else {
    docId = uniqueDocId(t, `INQ-${String(t.ingesteddocuments.length + 1).padStart(5, '0')}`);
  }

  t.ingesteddocuments.push({
    id: docId, created_at: now,
    document_name: a.raw.filename,
    vendor_name: ext?.vendor_name ?? 'Unknown Sender',
    intent, status,
    confidence_score: round1(a.confidence * 100),
    ingestion_date: now,
    invoice_number: type === 'invoice' ? ext?.invoice_number ?? null : null,
    source: a.source, provider: a.providerName, model: a.model ?? null,
    processing_ms: a.ms,
    summary: ext?.summary ?? (a.error ? `Could not be read automatically: ${a.error}` : null),
    warnings, review_reason: status === 'Needs Review' ? (a.reviewReason ?? match?.reason ?? a.error ?? null) : null,
    extraction: ext,
  });
  t.auditlogs.push({
    id: randomUUID(), created_at: now, timestamp: now, action_type: 'INGEST', document_id: docId,
    previous_status: 'Received', new_status: status, actor: a.source,
    detail: `${intent} via ${a.providerName} (${round1(a.confidence * 100)}%)${warnings.length ? ` – ${warnings.length} warning(s)` : ''}`,
  });

  return {
    ok: !a.error, docId, intent, status, confidence: round1(a.confidence * 100), provider: a.providerName, model: a.model,
    summary: ext?.summary ?? null, warnings, extraction: ext, match, invoiceId, processingMs: a.ms, error: a.error,
  };
}

export async function ingestDocument(store: JsonStore, raw: RawDocument, opts: IngestOptions): Promise<IngestResult> {
  const t0 = Date.now();
  const minConf = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const source = opts.source ?? 'api';
  const autoMatch = opts.autoMatch !== false;
  const base = { raw, autoMatch, source };

  // 1. Prepare (pdf text, eml parse, ...). Unsupported/empty input is recorded, not thrown away.
  let prep;
  try {
    prep = await prepareDocument(raw);
  } catch (e: any) {
    return store.transact(t => persist(t, {
      ...base, ext: null, confidence: 0, warnings: [], providerName: opts.provider.name, needsReview: true,
      reviewReason: String(e.message ?? e), ms: Date.now() - t0, error: String(e.message ?? e),
    }));
  }

  // 2. Extract
  let rawExt: unknown;
  let providerName: string = opts.provider.name;
  let model: string | undefined;
  const warnings: string[] = [...prep.notes];
  let forcedReview: string | null = null;

  try {
    const r = await opts.provider.extract(prep.input);
    rawExt = r.raw; model = r.model;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (opts.provider.name === 'gemini' && prep.input.text.trim().length >= 20) {
      // Loud fallback: never silent, never auto-posted.
      warnings.push(`LLM call failed (${msg.slice(0, 200)}); used the offline rules parser instead`);
      providerName = 'rules-fallback';
      forcedReview = 'LLM unavailable: extracted with the offline fallback parser';
      rawExt = (await new RulesProvider().extract(prep.input)).raw;
      model = 'rules';
    } else if (opts.provider.name === 'rules') {
      const m = 'No LLM configured and this file has no text to parse offline. Set GEMINI_API_KEY to read scans and images.';
      return store.transact(t => persist(t, {
        ...base, ext: null, confidence: 0, warnings, providerName: 'rules', needsReview: true,
        reviewReason: m, ms: Date.now() - t0, error: m,
      }));
    } else {
      return store.transact(t => persist(t, {
        ...base, ext: null, confidence: 0, warnings, providerName: opts.provider.name, needsReview: true,
        reviewReason: msg, ms: Date.now() - t0, error: msg,
      }));
    }
  }

  // 3. Deterministic audit of what the model said
  const a = audit(coerce(rawExt), prep.sourceText);
  warnings.push(...a.warnings);
  const ext = a.extraction;
  const conf = forcedReview ? Math.min(a.confidence, minConf - 0.01) : a.confidence;

  let reviewReason: string | null = forcedReview;
  if (!reviewReason && conf < minConf) reviewReason = `Low confidence (${Math.round(conf * 100)}%)${a.warnings.length ? `: ${a.warnings[0]}` : ''}`;
  if (!reviewReason && ext.document_type === 'invoice' && (!ext.invoice_number || ext.total_amount === null)) {
    reviewReason = 'Invoice number or total missing';
  }
  if (!reviewReason && ext.document_type !== 'invoice' && ext.document_type !== 'acknowledgement') {
    reviewReason = ext.summary ?? 'Needs a human reply';
  }

  // 4. Persist (+ match / apply ack) atomically
  return store.transact(t => persist(t, {
    ...base, ext, confidence: conf, warnings, providerName, model,
    needsReview: reviewReason !== null, reviewReason, ms: Date.now() - t0,
  }));
}
