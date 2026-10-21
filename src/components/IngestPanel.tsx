import React, { useEffect, useRef, useState } from 'react';
import { Upload, FileText, RefreshCw, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getLlmStatus, ingestFile, ingestText } from '../services/ingestApi';
import type { IngestResult, LlmStatus } from '../services/ingestApi';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.eml,.txt,application/pdf,image/*,message/rfc822,text/plain';

export const IngestPanel: React.FC<{ onDone: () => void | Promise<void> }> = ({ onDone }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [text, setText] = useState('');
  const [results, setResults] = useState<(IngestResult & { name: string })[]>([]);
  const [llm, setLlm] = useState<LlmStatus | null>(null);

  useEffect(() => { getLlmStatus().then(setLlm).catch(() => setLlm(null)); }, []);

  const report = (name: string, r: IngestResult) => {
    setResults(prev => [{ ...r, name }, ...prev].slice(0, 6));
    const line = r.match ? `${r.intent} · ${r.match.status}: ${r.match.reason}` : `${r.intent} · ${r.status}`;
    if (r.status === 'Needs Review' || !r.ok) toast.warning(`${name}: needs review`, { description: r.error ?? r.match?.reason ?? r.summary ?? line });
    else toast.success(`${name}: ${r.status}`, { description: r.summary ?? line });
  };

  const run = async (jobs: { name: string; job: () => Promise<IngestResult> }[]) => {
    if (!jobs.length) return;
    setBusy(true);
    const id = toast.loading(`Reading ${jobs.length} document${jobs.length > 1 ? 's' : ''}…`);
    try {
      for (const j of jobs) {
        try { report(j.name, await j.job()); }
        catch (e: any) { toast.error(`${j.name}: ${e?.message ?? 'failed'}`); }
      }
    } finally {
      toast.dismiss(id);
      setBusy(false);
      await onDone();
    }
  };

  const onFiles = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    run(list.map(f => ({ name: f.name, job: () => ingestFile(f) })));
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="grid grid-cols-1 lg:grid-cols-5 gap-6" data-testid="ingest-panel">
      <div className="lg:col-span-3 space-y-3">
        <div
          data-testid="dropzone"
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${drag ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-border bg-slate-900/40 hover:border-slate-500'}`}
        >
          <input ref={inputRef} data-testid="file-input" type="file" multiple accept={ACCEPT} className="hidden" onChange={e => onFiles(e.target.files)} />
          {busy ? <RefreshCw className="mx-auto mb-3 animate-spin text-brand-accent" size={28} /> : <Upload className="mx-auto mb-3 text-brand-accent" size={28} />}
          <p className="text-white font-semibold">Drop vendor documents here, or click to browse</p>
          <p className="text-xs text-slate-400 mt-1">Scanned images, PDFs, forwarded emails (.eml), plain text. The AI reads them whatever the layout.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Sparkles size={14} className={llm?.live ? 'text-brand-success' : 'text-amber-400'} />
          <span data-testid="llm-status">
            {llm ? (llm.live ? 'Reading with Gemini' : `Offline reader (${llm.reason}). Scans and images need a Gemini key.`) : 'Reader status unavailable'}
          </span>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-2">
        <textarea
          data-testid="paste-text"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          placeholder="…or paste an email / jotted note, e.g. “Hi, invoice INV-9001 for PO-2024-100, 40 units @ 12.50, total $500”"
          className="w-full rounded-lg bg-slate-900/60 border border-brand-border p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-accent"
        />
        <button
          data-testid="paste-submit"
          disabled={busy || !text.trim()}
          onClick={() => { const t = text; setText(''); run([{ name: 'Pasted text', job: () => ingestText(t) }]); }}
          className="px-4 py-2 bg-brand-accent hover:bg-brand-accent/90 text-white rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-40"
        >
          <FileText size={16} /> Process pasted text
        </button>
      </div>

      {results.length > 0 && (
        <div className="lg:col-span-5 rounded-xl border border-brand-border divide-y divide-brand-border/60" data-testid="ingest-results">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-3 p-3 text-sm">
              {r.status === 'Needs Review' ? <AlertTriangle size={16} className="text-amber-400 mt-0.5" /> : <CheckCircle2 size={16} className="text-brand-success mt-0.5" />}
              <div className="min-w-0">
                <p className="text-white font-medium truncate">{r.name} <span className="text-slate-400 font-normal">→ {r.intent} · {r.status} · {r.confidence}% · {r.provider}</span></p>
                <p className="text-xs text-slate-400">{r.match?.reason ?? r.error ?? r.summary}</p>
                {r.warnings.length > 0 && <p className="text-xs text-amber-400/90">{r.warnings[0]}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
