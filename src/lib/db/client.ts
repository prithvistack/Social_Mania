import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service role key bypasses RLS, so this module must never reach the
 * browser. The `server-only` import above turns any client-component import
 * into a build error rather than a runtime leak.
 */
let cached: SupabaseClient | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "in .env.local, and run supabase/schema.sql in the SQL editor.",
    );
  }
}

export function getDb(): SupabaseClient {
  if (cached) return cached;
  if (!isDbConfigured()) throw new DatabaseNotConfiguredError();

  cached = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "quiet" } },
    },
  );
  return cached;
}

/**
 * Whether the schema has actually been applied.
 *
 * The repos treat a query error as "no rows", which is the right call for a
 * transient hiccup but would turn a missing schema into a feed that silently
 * claims you have no subscriptions. One cheap probe per process makes that
 * state visible instead.
 */
let schemaReady: boolean | null = null;

export async function isSchemaReady(): Promise<boolean> {
  if (schemaReady !== null) return schemaReady;
  if (!isDbConfigured()) return false;

  try {
    const { error } = await getDb().from("app_state").select("key").limit(1);
    // PGRST205 = table not in the schema cache, i.e. schema.sql never ran.
    schemaReady = !error || error.code !== "PGRST205";
  } catch {
    schemaReady = false;
  }
  return schemaReady;
}

/** Lets the next request re-probe, e.g. right after the schema is applied. */
export function resetSchemaProbe() {
  schemaReady = null;
}
