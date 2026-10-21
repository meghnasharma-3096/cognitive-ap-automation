/**
 * JSON-file data store with a small PostgREST-style query executor.
 *
 *   data/seed.json  -> committed "golden" dataset (source of truth for reset)
 *   data/db.json    -> live working copy (gitignored), rewritten atomically
 *
 * The browser talks to this through POST /api/db using the query descriptor
 * defined below (built by the Supabase-compatible shim in src/services/supabase.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

export const TABLE_NAMES = [
  'purchaseorders',
  'warehousereceipts',
  'vendorinvoices',
  'ingesteddocuments',
  'documentclusters',
  'auditlogs',
  'successreports',
  'exceptionreports',
] as const;

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in';

export type Filter =
  | { op: FilterOp; col: string; val: any }
  | { op: 'not'; col: string; inner: FilterOp; val: any }
  | { op: 'or'; groups: Filter[] };

export interface Query {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  values?: Row | Row[];
  filters?: Filter[];
  returning?: boolean;        // .select() was called (always true for op === 'select')
  columns?: string;           // '*' or 'a,b,c'
  order?: { col: string; ascending: boolean }[];
  limit?: number;
  single?: 'single' | 'maybe';
}

export interface DbError { message: string; code: string; details: string; hint: string }
export interface DbResult { data: any; error: DbError | null }

const err = (message: string, code = 'PGRST000'): DbResult => ({
  data: null,
  error: { message, code, details: '', hint: '' },
});

// ---------------------------------------------------------------- filtering

const isNil = (v: any) => v === null || v === undefined;

function likeToRegex(pattern: string, flags: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`, flags);
}

function cmp(a: any, b: any): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '') return na - nb;
  return String(a).localeCompare(String(b));
}

function test(row: Row, op: FilterOp, col: string, val: any): boolean {
  const v = row[col];
  switch (op) {
    case 'eq': return !isNil(v) && !isNil(val) && v === val;
    case 'neq': return isNil(v) ? !isNil(val) : v !== val;
    case 'gt': return !isNil(v) && cmp(v, val) > 0;
    case 'gte': return !isNil(v) && cmp(v, val) >= 0;
    case 'lt': return !isNil(v) && cmp(v, val) < 0;
    case 'lte': return !isNil(v) && cmp(v, val) <= 0;
    case 'like': return !isNil(v) && likeToRegex(String(val), '').test(String(v));
    case 'ilike': return !isNil(v) && likeToRegex(String(val), 'i').test(String(v));
    case 'is': return isNil(val) ? isNil(v) : v === val;
    // Unlike raw PostgREST, a null entry in the list matches NULL/missing values.
    // That is what every caller in this app means by .in('x', ['Pending', null]).
    case 'in': return (val as any[]).some(x => (isNil(x) ? isNil(v) : v === x));
  }
}

export function matches(row: Row, f: Filter): boolean {
  if (f.op === 'or') return f.groups.some(g => matches(row, g));
  if (f.op === 'not') return !test(row, f.inner, f.col, f.val);
  return test(row, f.op, f.col, f.val);
}

// -------------------------------------------------------------------- store

export class JsonStore {
  private tables: Tables = {};
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private dbPath: string,
    private seedPath: string,
  ) {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.load();
  }

  private emptyTables(): Tables {
    return Object.fromEntries(TABLE_NAMES.map(t => [t, [] as Row[]]));
  }

  private readSeed(): Tables {
    const seed = JSON.parse(fs.readFileSync(this.seedPath, 'utf8')) as Tables;
    return { ...this.emptyTables(), ...seed };
  }

  private load() {
    if (fs.existsSync(this.dbPath)) {
      try {
        this.tables = { ...this.emptyTables(), ...JSON.parse(fs.readFileSync(this.dbPath, 'utf8')) };
        return;
      } catch {
        console.warn(`[store] ${this.dbPath} unreadable, re-seeding`);
      }
    }
    this.tables = this.readSeed();
    this.flush();
  }

  private flush() {
    const tmp = `${this.dbPath}.tmp`;
    const json = JSON.stringify(this.tables, null, 2);
    fs.writeFileSync(tmp, json);
    // Windows: antivirus / indexers can briefly lock the target, making rename fail with EPERM/EBUSY/EACCES.
    // Retry for a moment; as a last resort write in place (still correct, just not atomic).
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        fs.renameSync(tmp, this.dbPath);
        return;
      } catch (e: any) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
      }
    }
    fs.writeFileSync(this.dbPath, json);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }

  /** Restore the golden seed. Returns row counts per table. */
  reset(): Record<string, number> {
    this.tables = this.readSeed();
    this.flush();
    return this.counts();
  }

  /** Remove every row from every table (no seed). */
  clear(): Record<string, number> {
    this.tables = this.emptyTables();
    this.flush();
    return this.counts();
  }

  counts(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.tables).map(([k, v]) => [k, v.length]));
  }

  snapshot(): Tables {
    return structuredClone(this.tables);
  }

  /**
   * Run `fn` with direct access to the tables as ONE atomic unit (no other
   * request can interleave), then persist. Use for multi-step business logic.
   */
  transact<T>(fn: (tables: Tables) => T): Promise<T> {
    const next = this.chain.then(() => {
      const out = fn(this.tables);
      this.flush();
      return out;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Serialised so concurrent requests never interleave read-modify-write. */
  run(q: Query): Promise<DbResult> {
    const next = this.chain.then(() => this.exec(q));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private exec(q: Query): DbResult {
    const rows = this.tables[q.table];
    if (!rows) return err(`relation "${q.table}" does not exist`, '42P01');

    const filters = q.filters ?? [];
    const hit = (r: Row) => filters.every(f => matches(r, f));
    let affected: Row[] = [];

    switch (q.op) {
      case 'select':
        affected = rows.filter(hit);
        break;
      case 'insert': {
        const incoming = Array.isArray(q.values) ? q.values : [q.values ?? {}];
        for (const v of incoming) {
          const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...v };
          rows.push(row);
          affected.push(row);
        }
        this.flush();
        break;
      }
      case 'update': {
        affected = rows.filter(hit);
        for (const r of affected) Object.assign(r, q.values);
        this.flush();
        break;
      }
      case 'delete': {
        affected = rows.filter(hit);
        this.tables[q.table] = rows.filter(r => !hit(r));
        this.flush();
        break;
      }
    }

    if (!q.returning && q.op !== 'select') return { data: null, error: null };

    let out = affected.map(r => structuredClone(r));

    for (const o of [...(q.order ?? [])].reverse()) {
      out.sort((a, b) => (isNil(a[o.col]) ? 1 : isNil(b[o.col]) ? -1 : cmp(a[o.col], b[o.col])) * (o.ascending ? 1 : -1));
    }
    if (q.limit !== undefined) out = out.slice(0, q.limit);

    if (q.columns && q.columns.trim() !== '*' && q.columns.trim() !== '') {
      const cols = q.columns.split(',').map(c => c.trim()).filter(Boolean);
      out = out.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
    }

    if (q.single === 'single') {
      if (out.length !== 1) {
        return err(`JSON object requested, multiple (or no) rows returned (${out.length})`, 'PGRST116');
      }
      return { data: out[0], error: null };
    }
    if (q.single === 'maybe') {
      if (out.length > 1) return err('Multiple rows returned for maybeSingle()', 'PGRST116');
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null };
  }
}
