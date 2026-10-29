"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Card, EmptyState, Skeleton } from "@/components/ui/card";
import { PAGE_SIZE } from "@/lib/config";
import { useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { createRequestGate } from "@/lib/request-control";

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  /** Server-side page fetch (page is 1-based). Called again whenever page/search/deps/refreshKey change. */
  fetchPage: (page: number, search: string, signal: AbortSignal) => Promise<{ rows: T[]; total: number }>;
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra controls (e.g. a filter dropdown) shown next to the search box. */
  toolbar?: React.ReactNode;
  /** Changing this value resets to page 1 and refetches (filters). */
  deps?: unknown[];
  /** Bump to refetch the current page (after mutations / realtime events). */
  refreshKey?: number;
  pollMs?: number;
  hideSearch?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  onError?: (message: string) => void;
}

export function PagedTable<T>({
  columns,
  fetchPage,
  rowKey,
  searchPlaceholder = "Search…",
  toolbar,
  deps = [],
  refreshKey = 0,
  pollMs,
  hideSearch,
  emptyTitle = "Nothing to show",
  emptyHint,
  onError,
}: Props<T>) {
  const [search, setSearch] = React.useState("");
  const debounced = useDebounced(search, 300);
  const depsKey = JSON.stringify(deps);
  // page resets to 1 whenever the search text or filters change (derived, no effect needed)
  const filterKey = `${debounced}|${depsKey}`;
  const [pageState, setPageState] = React.useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (fn: (p: number) => number) => setPageState({ key: filterKey, page: fn(page) });
  const [state, setState] = React.useState<{ rows: T[]; total: number } | null>(null);
  const fetchRef = React.useRef(fetchPage);
  const errRef = React.useRef(onError);
  const [requests] = React.useState(createRequestGate);
  React.useEffect(() => {
    fetchRef.current = fetchPage;
    errRef.current = onError;
  });

  const load = React.useCallback(
    async (background = false) => {
      const request = requests.start(background);
      if (!request) return;
      try {
        const res = await fetchRef.current(page, debounced, request.signal);
        if (!request.isCurrent()) return;
        const lastPage = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
        if (page > lastPage) setPageState({ key: filterKey, page: lastPage });
        else setState(res);
      } catch (e) {
        if (!request.isCurrent()) return;
        errRef.current?.(e instanceof Error ? e.message : "Could not load data");
        setState((s) => s ?? { rows: [], total: 0 });
      } finally {
        request.finish();
      }
    },
    [page, debounced, filterKey, requests],
  );

  React.useEffect(() => {
    void load();
    return () => requests.cancel();
  }, [load, refreshKey, requests]);

  React.useEffect(() => {
    if (!pollMs) return;
    // background tabs do not poll: keeps database load proportional to people actually looking
    const t = setInterval(() => document.visibilityState === "visible" && void load(true), pollMs);
    return () => clearInterval(t);
  }, [pollMs, load]);

  const total = state?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-3">
      {(!hideSearch || toolbar) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {!hideSearch && (
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <Card className="overflow-hidden">
        <div role="region" aria-label="Table results" tabIndex={0} className="overflow-x-auto focus-visible:-outline-offset-2">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/65 text-left text-xs text-muted-foreground">
              <tr>
                {columns.map((c) => (
                  <th key={c.header} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-medium", c.className)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {!state
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c.header} className="px-4 py-3">
                          <Skeleton className="h-5 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : state?.rows.map((row) => (
                    <tr key={rowKey(row)} className="transition-colors hover:bg-accent/35">
                      {columns.map((c) => (
                        <td key={c.header} className={cn("px-4 py-3 align-middle", c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {state && state.rows.length === 0 && (
          <EmptyState title={emptyTitle} hint={emptyHint} icon={<Inbox className="h-8 w-8" aria-hidden />} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
          <span aria-live="polite">{total > 0 ? `${from}–${to} of ${total}` : "0 results"}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
