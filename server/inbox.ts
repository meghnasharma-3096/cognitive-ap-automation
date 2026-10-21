/**
 * Inbox folder: drop PDFs / images / .eml / .txt into data/inbox and they are
 * ingested automatically. Success -> inbox/processed, failure -> inbox/failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ingestDocument } from './ingest';
import type { Provider } from './extraction/providers';
import type { JsonStore } from './store';

const OK_EXT = /\.(pdf|png|jpe?g|webp|eml|txt)$/i;

export async function drainInbox(store: JsonStore, provider: Provider, dir: string): Promise<number> {
  fs.mkdirSync(path.join(dir, 'processed'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'failed'), { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile() || !OK_EXT.test(name) || name.startsWith('.')) continue;
    // skip files still being written
    if (Date.now() - fs.statSync(full).mtimeMs < 800) continue;
    let ok = false;
    try {
      const r = await ingestDocument(store, { filename: name, dataBase64: fs.readFileSync(full).toString('base64') }, { provider, source: 'inbox' });
      ok = r.ok;
    } catch { ok = false; }
    fs.renameSync(full, path.join(dir, ok ? 'processed' : 'failed', `${Date.now()}-${name}`));
    n++;
  }
  return n;
}

export function startInbox(store: JsonStore, provider: Provider, dir: string, everyMs = 2000): () => void {
  fs.mkdirSync(dir, { recursive: true });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await drainInbox(store, provider, dir); } finally { busy = false; }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
