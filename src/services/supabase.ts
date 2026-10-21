/**
 * Drop-in replacement for the Supabase client, backed by the local JSON store
 * (see server/store.ts). The app code still calls `supabase.from(...)...` and
 * `supabase.functions.invoke(...)`, but everything now goes to /api on the
 * Express server. Only the pieces of the PostgREST builder this app uses (plus
 * a few common extras) are implemented.
 */
import type { Filter, FilterOp, Query } from '../../server/store';

interface DbError { message: string; code: string; details: string; hint: string }
interface DbResult<T = any> { data: T; error: DbError | null }

const netError = (e: unknown): DbError => ({
  message: e instanceof Error ? e.message : String(e),
  code: 'NETWORK',
  details: '',
  hint: 'Is the API server running? (npm run dev)',
});

async function post<T = any>(url: string, body: unknown): Promise<DbResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok && !json) return { data: null as T, error: netError(`HTTP ${res.status}`) };
    return json ?? { data: null as T, error: netError('Empty response') };
  } catch (e) {
    return { data: null as T, error: netError(e) };
  }
}

/** Parse "col.op.value,col.op.value" (PostgREST .or() syntax) into filters. */
function parseOr(expr: string): Filter[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);

  return parts.map(p => {
    const [col, op, ...rest] = p.split('.');
    const raw = rest.join('.');
    if (op === 'in') {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map(s => (s === 'null' ? null : s.replace(/^"|"$/g, '')));
      return { op: 'in', col, val: list } as Filter;
    }
    const val = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : raw;
    return { op: op as FilterOp, col, val } as Filter;
  });
}

class QueryBuilder implements PromiseLike<DbResult> {
  private q: Query;

  constructor(table: string) {
    this.q = { table, op: 'select', filters: [], returning: false };
  }

  select(columns = '*') {
    this.q.returning = true;
    this.q.columns = columns;
    return this;
  }
  insert(values: any) { this.q.op = 'insert'; this.q.values = values; return this; }
  update(values: any) { this.q.op = 'update'; this.q.values = values; return this; }
  delete() { this.q.op = 'delete'; return this; }

  private f(op: FilterOp, col: string, val: any) { this.q.filters!.push({ op, col, val }); return this; }
  eq(col: string, val: any) { return this.f('eq', col, val); }
  neq(col: string, val: any) { return this.f('neq', col, val); }
  gt(col: string, val: any) { return this.f('gt', col, val); }
  gte(col: string, val: any) { return this.f('gte', col, val); }
  lt(col: string, val: any) { return this.f('lt', col, val); }
  lte(col: string, val: any) { return this.f('lte', col, val); }
  like(col: string, val: string) { return this.f('like', col, val); }
  ilike(col: string, val: string) { return this.f('ilike', col, val); }
  is(col: string, val: any) { return this.f('is', col, val); }
  in(col: string, val: any[]) { return this.f('in', col, val); }
  not(col: string, op: FilterOp, val: any) {
    this.q.filters!.push({ op: 'not', col, inner: op, val });
    return this;
  }
  or(expr: string) { this.q.filters!.push({ op: 'or', groups: parseOr(expr) }); return this; }

  order(col: string, opts: { ascending?: boolean } = {}) {
    (this.q.order ??= []).push({ col, ascending: opts.ascending !== false });
    return this;
  }
  limit(n: number) { this.q.limit = n; return this; }
  single() { this.q.single = 'single'; this.q.returning = true; return this; }
  maybeSingle() { this.q.single = 'maybe'; this.q.returning = true; return this; }

  then<R1 = DbResult, R2 = never>(
    onfulfilled?: ((value: DbResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return post('/api/db', this.q).then(onfulfilled, onrejected);
  }
}

export const supabase = {
  from: (table: string) => new QueryBuilder(table),
};

/** Restore the seed dataset (also exposed as POST /api/reset). */
export async function resetDatabase(): Promise<DbResult<Record<string, number>>> {
  return post('/api/reset', {});
}
