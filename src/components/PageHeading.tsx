export function PageHeading({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-[22px] font-medium tracking-tight">{title}</h1>
        {meta && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
            {meta}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
