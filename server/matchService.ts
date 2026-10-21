/**
 * Applies the match engine to stored invoices, atomically and idempotently:
 * running it twice (React double-mount, double click, retry) never duplicates
 * reports, because reports are keyed by invoice id and rewritten in place.
 */
import { randomUUID } from 'node:crypto';
import type { JsonStore, Row, Tables } from './store';
import { DEFAULT_CONFIG, evaluateInvoice, findDuplicateOf, normPo } from './matchEngine';
import type { Decision, MatchConfig } from './matchEngine';

export interface RunOptions {
  /** Specific invoice ids to (re)evaluate. Omit to process everything still Pending/null. */
  invoiceIds?: string[];
  /** Re-evaluate every invoice regardless of current status. */
  all?: boolean;
  config?: MatchConfig;
  /** Who/what triggered it, for the audit log. */
  actor?: string;
}

export interface RunSummary {
  processed: number;
  success: number;
  exceptions: number;
  results: { id: string; invoice_number: string; status: 'Success' | 'Exception'; reason: string; code: string | null }[];
}

const isPending = (r: Row) => r.match_status == null || r.match_status === 'Pending';

export function applyMatch(t: Tables, opts: RunOptions = {}): RunSummary {
  const cfg = opts.config ?? DEFAULT_CONFIG;
  const invoices = t.vendorinvoices;
  const now = new Date().toISOString();

  const targets = invoices
    .map((inv, index) => ({ inv, index }))
    .filter(({ inv }) => !inv.manual_override) // a human decision is never overwritten by the engine
    .filter(({ inv }) => (opts.invoiceIds ? opts.invoiceIds.includes(inv.id) : opts.all ? true : isPending(inv)));

  const summary: RunSummary = { processed: 0, success: 0, exceptions: 0, results: [] };

  for (const { inv, index } of targets) {
    const poKey = normPo(inv.po_number);
    const po = t.purchaseorders.find(p => normPo(p.po_number) === poKey) ?? null;
    const receipt = t.warehousereceipts.find(r => normPo(r.po_number) === poKey) ?? null;
    const dup = findDuplicateOf(invoices as any, index);

    const d: Decision = evaluateInvoice(
      { ...(inv as any), vendor_name: inv.vendor_name ?? null },
      { po: po as any, receipt: receipt as any, duplicateOf: dup as any },
      cfg,
    );

    const previous = inv.match_status ?? 'Pending';
    inv.match_status = d.status;
    inv.notes = d.status === 'Success' ? 'Auto-reconciled' : d.notes;
    inv.match_code = d.primaryCode;
    inv.match_checks = d.checks;
    inv.matched_at = now;

    // Reports are keyed by invoice id: drop any earlier row, write the current verdict.
    t.successreports = t.successreports.filter(r => r.invoice_id !== inv.id);
    t.exceptionreports =t.exceptionreports.filter(r => r.invoice_id !== inv.id);

    const vendor = po?.vendor_name ?? inv.vendor_name ?? 'Unknown';
    if (d.status === 'Success') {
      t.successreports.push({
        id: randomUUID(), created_at: now, invoice_id: inv.id,
        invoice_number: inv.invoice_number, po_number: inv.po_number, vendor,
        amount: d.amounts.total ?? 0, status: 'Processed', notes: 'Three-way match passed', date: now,
      });
      summary.success++;
    } else {
      t.exceptionreports.push({
        id: randomUUID(), created_at: now, invoice_id: inv.id,
        invoice_number: inv.invoice_number, po_number: inv.po_number, vendor,
        billed_amount: d.amounts.total ?? 0, notes: d.notes, code: d.primaryCode, date: now,
      });
      summary.exceptions++;
    }

    t.auditlogs.push({
      id: randomUUID(), created_at: now, timestamp: now,
      action_type: 'MATCH', document_id: inv.invoice_number,
      previous_status: previous, new_status: d.status === 'Success' ? 'Matched' : 'Exception',
      actor: opts.actor ?? 'match-engine', detail: d.status === 'Success' ? 'All checks passed' : d.notes,
    });

    summary.processed++;
    summary.results.push({ id: inv.id, invoice_number: inv.invoice_number, status: d.status, reason: d.reason, code: d.primaryCode });
  }
  return summary;
}

export const runMatch = (store: JsonStore, opts: RunOptions = {}) =>
  store.transact(t => applyMatch(t, opts));

/**
 * Human override: accept an invoice the engine flagged. Moves it from the
 * exception report to the success report, keeping the original reason for audit.
 */
export function applyApprove(t: Tables, invoiceId: string, actor = 'user'): { ok: boolean; message: string } {
  const inv = t.vendorinvoices.find(i => i.id === invoiceId);
  if (!inv) return { ok: false, message: 'Invoice not found' };
  const now = new Date().toISOString();
  const previous = inv.match_status ?? 'Pending';
  const wasReason = inv.notes && inv.notes !== 'Auto-reconciled' ? ` (was: ${inv.notes})` : '';

  inv.match_status = 'Success';
  inv.manual_override = true;
  inv.notes = `Manually approved${wasReason}`;
  inv.matched_at = now;

  t.exceptionreports = t.exceptionreports.filter(r => r.invoice_id !== inv.id);
  t.successreports = t.successreports.filter(r => r.invoice_id !== inv.id);
  const po = t.purchaseorders.find(p => normPo(p.po_number) === normPo(inv.po_number));
  t.successreports.push({
    id: randomUUID(), created_at: now, invoice_id: inv.id,
    invoice_number: inv.invoice_number, po_number: inv.po_number,
    vendor: po?.vendor_name ?? inv.vendor_name ?? 'Unknown',
    amount: Number(inv.total_amount) || 0, status: 'Manually Approved', notes: inv.notes, date: now,
  });
  t.auditlogs.push({
    id: randomUUID(), created_at: now, timestamp: now,
    action_type: 'Manual Approval', document_id: inv.invoice_number,
    previous_status: previous, new_status: 'Approved', actor, detail: inv.notes,
  });
  return { ok: true, message: `Invoice ${inv.invoice_number} manually approved` };
}

export const approveInvoice = (store: JsonStore, invoiceId: string, actor?: string) =>
  store.transact(t => applyApprove(t, invoiceId, actor));
