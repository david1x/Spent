"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface CardShellProps {
  label?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CardShell({ label, action, children, className }: CardShellProps) {
  return (
    <section
      className={cn(
        "flex h-full min-w-0 flex-col rounded-xl border border-border bg-card px-5 py-5 shadow-[0_1px_2px_oklch(0.4_0.03_70/0.06),0_8px_24px_-12px_oklch(0.4_0.03_70/0.14)] md:px-[1.375rem]",
        className
      )}
    >
      {(label || action) && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          {label && (
            <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              {label}
            </h3>
          )}
          {action && (
            <div className="shrink-0 text-[12.5px] text-muted-foreground">{action}</div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function CardAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-sm underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

export function CardSkeleton({
  label,
  height = 140,
  className,
}: {
  label?: string;
  height?: number;
  className?: string;
}) {
  return (
    <CardShell label={label} className={className}>
      <Skeleton className="w-full rounded-lg" style={{ height }} />
    </CardShell>
  );
}

export function CardError({ label, className }: { label?: string; className?: string }) {
  const t = useTranslations("home");
  return (
    <CardShell label={label} className={className}>
      <div className="flex flex-1 items-center justify-center py-8 text-sm text-muted-foreground">
        {t("couldntLoad")}
      </div>
    </CardShell>
  );
}
