import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-start justify-center gap-4">
      <h1 className="text-[22px] font-medium tracking-tight">Not here</h1>
      <p className="text-[13.5px] text-muted">
        That video or channel isn&apos;t available through the API.
      </p>
      <Link
        href="/"
        className="rounded-md border border-line px-3.5 py-2 text-[13px] transition-colors hover:border-accent hover:text-accent"
      >
        Back to your feed
      </Link>
    </div>
  );
}
