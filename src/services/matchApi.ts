/** Client helpers for the server-side three-way match (single source of truth). */
export interface MatchRunResult {
  processed: number;
  success: number;
  exceptions: number;
  results: { id: string; invoice_number: string; status: 'Success' | 'Exception'; reason: string; code: string | null }[];
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}

/** Evaluate pending invoices (default), specific invoices, or everything. */
export const runMatchApi = (opts: { invoiceIds?: string[]; all?: boolean } = {}) =>
  post<MatchRunResult>('/api/match/run', opts);

export const approveInvoiceApi = (invoiceId: string) =>
  post<{ ok: boolean; message: string }>('/api/match/approve', { invoiceId });
