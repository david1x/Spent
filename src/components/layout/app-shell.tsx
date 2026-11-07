"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { SyncProvider } from "@/components/dashboard/sync-button";
import { AppSidebar } from "./app-sidebar";
import { MobileTabBar } from "./mobile-tab-bar";
import { AmountsToggle } from "./amounts-toggle";
import { ScopePicker } from "./scope-picker";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <SyncProvider>
        <AppSidebar />
        {/* Room for the fixed bottom tab bar on phones. */}
        <SidebarInset className="pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </SidebarInset>
        <MobileTabBar />
      </SyncProvider>
    </SidebarProvider>
  );
}

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  /** Secondary context, usually the selected month. */
  meta?: string;
  actions?: ReactNode;
}) {
  const t = useTranslations("nav");
  // On phones the tab bar already says where you are, and a month switcher in
  // the actions repeats `meta`, so a page with meta drops its visible title
  // instead of truncating it.
  const hideTitleOnPhone = Boolean(meta);

  return (
    <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4 md:h-16 md:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <SidebarTrigger
            className="-ms-1 md:hidden"
            aria-label={t("openMenu")}
          />
          <h1
            className={cn(
              "truncate font-serif text-xl leading-none tracking-tight sm:text-2xl",
              hideTitleOnPhone && "max-sm:sr-only"
            )}
          >
            {title}
          </h1>
          {meta && (
            <>
              <span aria-hidden className="hidden text-sm text-muted-foreground sm:inline">
                ·
              </span>
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                {meta}
              </span>
            </>
          )}
        </div>
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-2">
          <ScopePicker />
          <AmountsToggle />
          {actions}
        </div>
      </div>
    </header>
  );
}
