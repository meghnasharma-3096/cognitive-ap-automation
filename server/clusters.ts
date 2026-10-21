/**
 * Intelligence clusters, computed from live data (nothing seeded).
 * One cluster per root cause of an open match exception, plus one for documents
 * the ingestion step held back for a human. A cluster disappears once every invoice in it
 * has been approved or routed back to the vendor.
 */
import { randomUUID } from 'node:crypto';
import type { Row, Tables } from './store';
import { applyApprove } from './matchService';

export interface ClusterDoc { id: string; invoice_number: string; vendor: string; amount: number; detail: string }
export interface Cluster {
  id: string;                 // stable: the cause code, e.g. "FREIGHT"
  cluster_name: string;
  category: 'Compliance' | 'Pricing' | 'Quantity' | 'Master Data' | 'Extraction';
  description: string;
  document_count: number;
  total_impact_amount: number;
  confidence: number | null;  // mean extraction confidence of the documents, when known
  docs: ClusterDoc[];
}

const META: Record<string, { name: string; category: Cluster['category']; desc: string }> = {
  DUPLICATE: { name: 'Duplicate invoice numbers', category: 'Compliance', desc: 'The same invoice number was filed more than once. Paying both would double-pay.' },
  FREIGHT: { name: 'Unapproved freight', category: 'Pricing', desc: 'Freight was billed that the purchase order does not authorise.' },
  PRICE: { name: 'Price variance', category: 'Pricing', desc: 'Unit price differs from the purchase order by more than the tolerance.' },
  QTY_VS_RECEIPT: { name: 'Billed more than received', category: 'Quantity', desc: 'The vendor billed more units than the warehouse received.' },
  QTY_VS_PO: { name: 'Billed more than ordered', category: 'Quantity', desc: 'The vendor billed more units than the purchase order allows.' },
  PO_MISSING: { name: 'No matching purchase order', category: 'Master Data', desc: 'The invoice references a PO that does not exist in the ERP.' },
  RECEIPT_MISSING: { name: 'No goods receipt', category: 'Master Data', desc: 'Nothing has been received yet for this purchase order.' },
  VENDOR_MISMATCH: { name: 'Vendor does not match PO', category: 'Master Data', desc: 'The invoicing vendor differs from the vendor on the purchase order.' },
  TOTAL_MISSING: { name: 'Invoice total missing', category: 'Extraction', desc: 'No total could be read from the invoice.' },
  REVIEW: { name: 'Held for review at ingestion', category: 'Extraction', desc: 'Documents the reader was not confident about, or that need a human reply.' },
};

const open = (inv: Row | undefined) => !!inv && !inv.vendor_action && inv.match_status !== 'Success';

export function buildClusters(t: Tables): Cluster[] {
  const byCode = new Map<string, ClusterDoc[]>();
  const conf = new Map<string, number[]>();
  const add = (code: string, d: ClusterDoc, c?: number | null) => {
    if (!byCode.has(code)) { byCode.set(code, []); conf.set(code, []); }
    byCode.get(code)!.push(d);
    if (typeof c === 'number') conf.get(code)!.push(c);
  };

  for (const inv of t.vendorinvoices) {
    if (inv.match_status !== 'Exception' || inv.vendor_action) continue;
    const code = String(inv.match_code ?? 'UNKNOWN');
    add(code, {
      id: inv.id, invoice_number: inv.invoice_number, vendor: inv.vendor_name ?? 'Unknown',
      amount: Number(inv.total_amount) || 0, detail: String(inv.notes ?? ''),
    }, inv.extraction_confidence);
  }
  // Ingested documents held back before any matching happened (low confidence, outage, inquiry...)
  for (const d of t.ingesteddocuments) {
    if (d.status !== 'Needs Review' || d.dismissed) continue;
    const inv = d.invoice_number ? t.vendorinvoices.find(i => i.source_doc_id === d.id) : undefined;
    if (inv && inv.match_status === 'Exception') continue; // already shown under its cause
    if (inv && !open(inv) ) continue;
    add('REVIEW', {
      id: inv?.id ?? d.id, invoice_number: d.invoice_number ?? d.document_name, vendor: d.vendor_name ?? 'Unknown',
      amount: Number(inv?.total_amount) || 0, detail: String(d.review_reason ?? d.summary ?? ''),
    }, d.confidence_score);
  }

  return [...byCode.entries()].map(([code, docs]) => {
    const m = META[code] ?? { name: code, category: 'Compliance' as const, desc: 'Open exceptions of this type.' };
    const cs = conf.get(code)!;
    return {
      id: code, cluster_name: m.name, category: m.category, description: m.desc,
      document_count: docs.length,
      total_impact_amount: Math.round(docs.reduce((s, d) => s + d.amount, 0) * 100) / 100,
      confidence: cs.length ? Math.round((cs.reduce((a, b) => a + b, 0) / cs.length) * 10) / 10 : null,
      docs,
    };
  }).sort((a, b) => b.total_impact_amount - a.total_impact_amount || b.document_count - a.document_count);
}

export type ClusterAction = 'approve' | 'reject';

/** Approve: pay every invoice in the cluster (sticky manual override). Reject: route back to the vendor. */
export function resolveCluster(t: Tables, id: string, action: ClusterAction, actor = 'user'): { ok: boolean; message: string; count: number } {
  const cluster = buildClusters(t).find(c => c.id === id);
  if (!cluster) return { ok: false, message: 'Cluster not found (already resolved?)', count: 0 };
  const now = new Date().toISOString();
  let n = 0;
  for (const d of cluster.docs) {
    const inv = t.vendorinvoices.find(i => i.id === d.id);
    if (inv) {
      if (action === 'approve') applyApprove(t, inv.id, actor);
      else {
        inv.vendor_action = 'Routed to vendor';
        inv.notes = `Rejected, routed to vendor (was: ${inv.notes ?? d.detail})`;
        t.auditlogs.push({
          id: randomUUID(), created_at: now, timestamp: now, action_type: 'Reject to Vendor', document_id: inv.invoice_number,
          previous_status: String(inv.match_status ?? 'Exception'), new_status: 'Rejected', actor, detail: d.detail,
        });
      }
    } else {
      const doc = t.ingesteddocuments.find(x => x.id === d.id);
      if (doc) {
        doc.dismissed = true;
        t.auditlogs.push({
          id: randomUUID(), created_at: now, timestamp: now, action_type: action === 'approve' ? 'Review Cleared' : 'Reject to Vendor',
          document_id: doc.id, previous_status: 'Needs Review', new_status: action === 'approve' ? 'Cleared' : 'Rejected', actor, detail: d.detail,
        });
      }
    }
    n++;
  }
  t.auditlogs.push({
    id: randomUUID(), created_at: now, timestamp: now, action_type: 'Bulk Resolution', document_id: cluster.cluster_name,
    previous_status: 'Requires Review', new_status: action === 'approve' ? 'Approved' : 'Rejected', actor, detail: `${n} document(s)`,
  });
  return { ok: true, message: `${action === 'approve' ? 'Approved' : 'Rejected'} ${n} document(s)`, count: n };
}
