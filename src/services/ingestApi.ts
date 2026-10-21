/** Client helpers for the server-side ingestion pipeline. */
export interface IngestResult {
  ok: boolean;
  docId: string;
  intent: 'Invoice' | 'Acknowledgement' | 'Inquiry';
  status: 'Auto-posted' | 'Matched' | 'Needs Review';
  confidence: number;
  provider: string;
  model?: string;
  summary: string | null;
  warnings: string[];
  match: { status: string; reason: string; code: string | null } | null;
  processingMs: number;
  error?: string;
}

export interface LlmStatus { provider: 'gemini' | 'fixture' | 'rules'; reason: string; live: boolean }

async function call<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export async function ingestFile(file: File): Promise<IngestResult> {
  return call<IngestResult>('/api/ingest', { filename: file.name, mimeType: file.type, dataBase64: await toBase64(file), source: 'ui' });
}

export const ingestText = (text: string, filename = 'pasted-email.txt') =>
  call<IngestResult>('/api/ingest', { filename, text, source: 'ui' });

export const getLlmStatus = () => call<LlmStatus>('/api/llm/status', undefined, 'GET');
