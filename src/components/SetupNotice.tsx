import { isDbConfigured } from "@/lib/db/client";

/**
 * Shown when Supabase is unconfigured OR configured but the schema has not
 * been applied. The two states need different instructions, and the second is
 * easy to mistake for "you have no subscriptions" if it isn't named.
 */
export function SetupNotice() {
  const connected = isDbConfigured();
  const projectRef = process.env.SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\./)?.[1];

  return (
    <div className="flex min-h-[60vh] max-w-2xl flex-col justify-center gap-5 py-16">
      <h1 className="text-[22px] font-medium tracking-tight">
        {connected ? "One step left: run the schema" : "Connect Supabase"}
      </h1>

      {connected ? (
        <>
          <p className="text-[13.5px] leading-relaxed text-muted">
            Supabase is connected, but the tables don&apos;t exist yet. Open the SQL editor,
            paste all of <code className="text-ink">supabase/schema.sql</code>, and run it.
            It&apos;s idempotent, so re-running it later is safe.
          </p>
          {projectRef && (
            <a
              href={`https://supabase.com/dashboard/project/${projectRef}/sql/new`}
              target="_blank"
              rel="noreferrer noopener"
              className="w-fit rounded-md border border-line px-3.5 py-2 text-[13px] transition-colors hover:border-accent hover:text-accent"
            >
              Open the SQL editor ↗
            </a>
          )}
          <p className="text-[12.5px] leading-relaxed text-faint">
            Then reload this page. Until the tables exist every query comes back empty,
            which would otherwise look like an empty feed rather than a setup step.
          </p>
        </>
      ) : (
        <>
          <p className="text-[13.5px] leading-relaxed text-muted">
            Quiet stores your feed, history and courses in Supabase. Create a project, run{" "}
            <code className="text-ink">supabase/schema.sql</code> in its SQL editor, then set{" "}
            <code className="text-ink">SUPABASE_URL</code> and{" "}
            <code className="text-ink">SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
            <code className="text-ink">.env.local</code> and restart the dev server.
          </p>
          <p className="text-[12.5px] leading-relaxed text-faint">
            The service role key bypasses row-level security, so it is only ever read on the
            server. It is never sent to the browser.
          </p>
        </>
      )}
    </div>
  );
}
