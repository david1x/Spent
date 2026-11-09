"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { navItemsFor } from "./nav-items";
import { useAccess } from "@/components/access-provider";
import { useTransactionsBadge } from "./use-review-count";

/** Bottom navigation for phones and tablets, where the sidebar is a drawer. */
export function MobileTabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const reviewCount = useTransactionsBadge();
  const { readOnly } = useAccess();

  return (
    <nav
      aria-label={t("primaryNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 px-1.5 pt-1">
        {navItemsFor(readOnly).map((item) => {
          const active = item.match(pathname);
          const label = t(item.labelKey);
          const badge =
            item.showReviewBadge && reviewCount != null && reviewCount > 0
              ? reviewCount
              : null;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={
                  badge != null ? t("withReviewCount", { label, count: badge }) : undefined
                }
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 pb-1 pt-1.5 text-[10.5px] leading-tight tracking-tight min-[400px]:text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "font-semibold text-primary"
                    : "font-medium text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="relative">
                  <item.Icon aria-hidden className="size-5" strokeWidth={active ? 2.1 : 1.8} />
                  {badge != null && (
                    <span
                      aria-hidden
                      className="absolute -top-1.5 start-3 min-w-4 rounded-full bg-[color-mix(in_oklch,var(--status-heads-up)_28%,var(--card))] px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-[color-mix(in_oklch,var(--status-heads-up)_45%,var(--foreground))] ring-2 ring-card"
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
