import { Skeleton } from "@/components/ui/card";

export function PortalLoading() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-6">
      <span className="sr-only">Loading page…</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 max-w-md" />
      <div className="rounded-xl border bg-card p-5">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="my-4 h-8 w-full" />)}
      </div>
    </div>
  );
}
