"use client";
// Pages and filters kept in the URL (?page=2, ?type=verdicts…): shareable, and the browser's Back steps through them.
// Every other param (the source, e2e) is kept as it is.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** set (or clear) URL params without scrolling the page: one history entry per change */
export function useUrlParams() {
  const q = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  return useCallback(
    (set: Record<string, string | number | null>) => {
      const u = new URLSearchParams(q.toString());
      for (const [k, v] of Object.entries(set)) {
        if (v === null || v === "" || (k.endsWith("page") && Number(v) <= 1)) u.delete(k);
        else u.set(k, String(v));
      }
      const qs = u.toString();
      router.push(qs ? `${path}?${qs}` : path, { scroll: false });
    },
    [q, router, path],
  );
}

/** one paginated list: which page the URL asks for (clamped), its slice, and a way to move */
export function usePager(total: number, perPage: number, param = "page") {
  const q = useSearchParams();
  const set = useUrlParams();
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(q.get(param)) || 1)));
  const start = (page - 1) * perPage;
  return {
    page,
    pages,
    start,
    end: Math.min(total, start + perPage),
    go: (p: number) => set({ [param]: p }),
  };
}

/** a filter kept in the URL (resets the list's page when it changes) */
export function useFilter<T extends string>(param: string, values: readonly T[], fallback: T, pageParam = "page") {
  const q = useSearchParams();
  const set = useUrlParams();
  const raw = q.get(param) as T | null;
  const value = raw && values.includes(raw) ? raw : fallback;
  return [value, (v: T) => set({ [param]: v === fallback ? null : v, [pageParam]: null })] as const;
}
