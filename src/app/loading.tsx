export default function Loading() {
  return (
    <div className="py-10 sm:py-14">
      <div className="mb-10 h-6 w-28 animate-pulse rounded bg-raised" />
      <div className="flex flex-col gap-7">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-4 sm:gap-5">
            <div className="aspect-video w-[42%] max-w-[240px] shrink-0 animate-pulse rounded-[var(--radius-card)] bg-raised" />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 py-1">
              <div className="h-4 w-4/5 animate-pulse rounded bg-raised" />
              <div className="h-4 w-2/5 animate-pulse rounded bg-raised" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-raised" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
