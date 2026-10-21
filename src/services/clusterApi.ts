/** Intelligence clusters are computed on the server from live match results. */
export interface ClusterDoc { id: string; invoice_number: string; vendor: string; amount: number; detail: string }
export interface LiveCluster {
  id: string;
  cluster_name: string;
  category: string;
  description: string;
  document_count: number;
  total_impact_amount: number;
  confidence: number | null;
  docs: ClusterDoc[];
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}

export const getClusters = () => call<LiveCluster[]>('/api/clusters');
export const resolveClusterApi = (id: string, action: 'approve' | 'reject') =>
  call<{ ok: boolean; message: string; count: number }>(`/api/clusters/${encodeURIComponent(id)}/resolve`, { action });
