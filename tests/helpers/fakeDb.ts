/**
 * A tiny in-memory stand-in for the Supabase client, covering the subset of
 * the query builder this app uses. It lets the repos be tested for real —
 * including delete cascades — without a Supabase project or any network.
 */

type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);

class Query implements PromiseLike<{ data: any; error: any; count?: number }> {
  private filters: Filter[] = [];
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;
  private single = false;
  private onConflict: string | null = null;

  private store: Map<string, Row[]>;
  private table: string;
  private log: string[];

  // Plain fields, not parameter properties: Node's strip-only TypeScript
  // support rejects the shorthand.
  constructor(store: Map<string, Row[]>, table: string, log: string[]) {
    this.store = store;
    this.table = table;
    this.log = log;
  }

  private rows(): Row[] {
    if (!this.store.has(this.table)) this.store.set(this.table, []);
    return this.store.get(this.table)!;
  }

  select(_cols?: string, opts?: { count?: string }) {
    if (this.mode === "select") this.mode = "select";
    if (opts?.count) this.wantCount = true;
    return this;
  }
  private wantCount = false;

  insert(values: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.onConflict = opts?.onConflict ?? "id";
    return this;
  }

  update(values: Row) {
    this.mode = "update";
    this.payload = [values];
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(col: string, val: any) { this.filters.push((r) => r[col] === val); return this; }
  neq(col: string, val: any) { this.filters.push((r) => r[col] !== val); return this; }
  gt(col: string, val: any) { this.filters.push((r) => r[col] > val); return this; }
  gte(col: string, val: any) { this.filters.push((r) => r[col] >= val); return this; }
  lt(col: string, val: any) { this.filters.push((r) => r[col] < val); return this; }
  lte(col: string, val: any) { this.filters.push((r) => r[col] <= val); return this; }
  is(col: string, val: any) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  in(col: string, vals: any[]) {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  limit(n: number) { this.limitTo = n; return this; }
  maybeSingle() { this.single = true; return this; }

  private matching(): Row[] {
    return this.rows().filter((row) => this.filters.every((f) => f(row)));
  }

  private run(): { data: any; error: any; count?: number } {
    const rows = this.rows();
    this.log.push(`${this.mode} ${this.table}`);

    if (this.mode === "insert") {
      const added = this.payload.map((r) => ({ ...r }));
      rows.push(...added);
      return { data: added, error: null };
    }

    if (this.mode === "upsert") {
      const keys = this.onConflict!.split(",").map((k) => k.trim());
      const added: Row[] = [];
      for (const value of this.payload) {
        const idx = rows.findIndex((r) => keys.every((k) => r[k] === value[k]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...value };
        else rows.push({ ...value });
        added.push({ ...value });
      }
      return { data: added, error: null };
    }

    if (this.mode === "update") {
      const hits = this.matching();
      for (const row of hits) Object.assign(row, this.payload[0]);
      return { data: hits, error: null };
    }

    if (this.mode === "delete") {
      const doomed = new Set(this.matching());
      const kept = rows.filter((r) => !doomed.has(r));
      this.store.set(this.table, kept);
      return { data: [...doomed], error: null, count: doomed.size };
    }

    let out = this.matching().map((r) => ({ ...r }));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      out.sort((a, b) => (ascending ? cmp(a[column], b[column]) : cmp(b[column], a[column])));
    }
    const count = out.length;
    if (this.limitTo !== null) out = out.slice(0, this.limitTo);
    if (this.single) return { data: out[0] ?? null, error: null, count };
    return { data: out, error: null, count };
  }

  then<R1 = any, R2 = never>(
    onfulfilled?: ((v: { data: any; error: any; count?: number }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    try {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected);
    }
  }
}

export type FakeDb = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  table: (name: string) => Row[];
  calls: string[];
  /** Set to make rpc() report failure, exercising fallback paths. */
  rpcBroken: boolean;
};

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const store = new Map<string, Row[]>();
  for (const [name, rows] of Object.entries(seed)) {
    store.set(name, rows.map((r) => ({ ...r })));
  }
  const calls: string[] = [];

  const db: FakeDb = {
    calls,
    rpcBroken: false,
    table: (name) => store.get(name) ?? [],
    from: (table) => new Query(store, table, calls),
    rpc: (fn, args) => {
      calls.push(`rpc ${fn}`);
      if (db.rpcBroken) {
        return Promise.resolve({ data: null, error: new Error("rpc unavailable") });
      }
      if (fn === "quota_used_since") {
        const since = String((args as any)?.since ?? "");
        const total = (store.get("quota_log") ?? [])
          .filter((r) => r.outcome === "ok" && String(r.created_at) >= since)
          .reduce((sum, r) => sum + Number(r.units ?? 0), 0);
        return Promise.resolve({ data: total, error: null });
      }
      if (fn === "search_videos") {
        const q = String((args as any)?.q ?? "").toLowerCase();
        const hits = (store.get("videos") ?? []).filter((v) =>
          `${v.title ?? ""} ${v.description ?? ""}`.toLowerCase().includes(q),
        );
        return Promise.resolve({ data: hits, error: null });
      }
      return Promise.resolve({ data: null, error: new Error(`unmocked rpc ${fn}`) });
    },
  };
  return db;
}
