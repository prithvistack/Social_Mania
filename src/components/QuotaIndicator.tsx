export type QuotaStatus = {
  used: number;
  budget: number;
  remaining: number;
  percent: number;
  resetsAt: string;
};

/**
 * Deliberately quiet: a thin bar and a line of numbers. It is only ever shown
 * in Settings, so the feed itself stays free of instrumentation.
 */
export function QuotaIndicator({ status }: { status: QuotaStatus }) {
  const tight = status.percent >= 80;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
        YouTube API budget today
      </h2>
      <span className="h-[6px] w-full overflow-hidden rounded-full bg-raised">
        <span
          className={`block h-full ${tight ? "bg-amber-500/80" : "bg-accent"}`}
          style={{ width: `${Math.max(1, status.percent)}%` }}
        />
      </span>
      <p className="text-[12.5px] text-muted tabular-nums">
        {status.used.toLocaleString()} of {status.budget.toLocaleString()} units ·{" "}
        {status.remaining.toLocaleString()} left · resets{" "}
        {new Date(status.resetsAt).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
      {tight && (
        <p className="text-[12px] leading-relaxed text-faint">
          Close to the budget. Background refreshes will fall back to cached data rather
          than fail.
        </p>
      )}
    </section>
  );
}
