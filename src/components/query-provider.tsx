"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

/** How often a visible page asks whether the data changed. The check is one tiny query. */
const LIVE_CHECK_MS = 4_000;

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <LiveData />
      {children}
    </QueryClientProvider>
  );
}

/**
 * Keeps every open page in step with the database: when anything is written
 * (an edit on another page or tab, a sync, background categorizing), the
 * data on screen is refetched. Checks only while the page is visible, and
 * right away when it comes back into view.
 */
function LiveData() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let seen: string | null = null;
    let checking = false;

    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      // Nothing to keep fresh there, and a 401 would send it back to itself.
      if (window.location.pathname.startsWith("/login")) return;
      checking = true;
      try {
        const res = await fetch("/api/data-version", { cache: "no-store" });
        if (res.status === 401) {
          // Signed out (session ended, or signed out elsewhere): back to sign-in.
          const next = window.location.pathname + window.location.search;
          window.location.assign(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: string };
        if (seen !== null && version !== seen) {
          // Only queries on screen refetch now; the rest refetch when next shown.
          void queryClient.invalidateQueries();
        }
        seen = version;
      } catch {
        // Server restarting or offline; try again on the next tick.
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = window.setInterval(check, LIVE_CHECK_MS);
    const onShow = () => void check();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [queryClient]);

  return null;
}
