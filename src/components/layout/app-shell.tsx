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
import { ViewOnlyBadge } from "@/components/sharing/view-only-badge";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <SyncProvider>
        <AppSidebar />
        {/* Room for the fixed bottom tab bar on phones and tablets. min-w-0
            so long, truncated text can't widen the page past the screen. */}
        <SidebarInset className="min-w-0 pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">
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
  toolbar,
}: {
  title: string;
  /** Secondary context, usually the selected month. */
  meta?: string;
  actions?: ReactNode;
  /**
   * Wide page controls (view tabs, a period picker). Beside the actions on
   * wide screens; below that they get a row of their own under
   * the title, so the header never runs wider than the screen.
   */
  toolbar?: ReactNode;
}) {
  const t = useTranslations("nav");
  // On phones the tab bar already says where you are, and a month switcher in
  // the actions repeats `meta`, so a page with meta drops its visible title
  // instead of truncating it. With a toolbar row below there's room for it.
  const hideTitleOnPhone = Boolean(meta) && !toolbar;

  return (
    <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur">
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4 md:px-6 lg:px-8",
          toolbar ? "min-h-14 flex-wrap gap-y-2 py-2 md:min-h-16 2xl:h-16 2xl:flex-nowrap 2xl:py-0" : "h-14 md:h-16"
        )}
      >
        <div className="order-1 flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <SidebarTrigger
            className="-ms-1 lg:hidden"
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
              <span aria-hidden className={cn("hidden text-sm text-muted-foreground", toolbar ? "2xl:inline" : "sm:inline")}>
                ·
              </span>
              <span className={cn("hidden truncate text-sm text-muted-foreground", toolbar ? "2xl:inline" : "sm:inline")}>
                {meta}
              </span>
            </>
          )}
        </div>
        <div className="order-2 flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-2">
          <ViewOnlyBadge />
          <ScopePicker />
          <AmountsToggle />
          {toolbar ? null : actions}
        </div>
        {toolbar ? (
          <>
            <div className="order-4 flex w-full min-w-0 items-center justify-between gap-2 2xl:order-3 2xl:w-auto 2xl:justify-end">
              {toolbar}
            </div>
            {actions ? <div className="order-3 flex shrink-0 items-center gap-1.5 2xl:order-4">{actions}</div> : null}
          </>
        ) : null}
      </div>
    </header>
  );
}
