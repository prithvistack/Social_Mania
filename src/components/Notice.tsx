export function Notice({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4">
      <p className="text-[13.5px] font-medium">{title}</p>
      {children && (
        <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{children}</div>
      )}
    </div>
  );
}
