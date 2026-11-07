"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Shared behavior for every chart: hovering (or focusing) a mark shows a
 * tooltip with its exact figures, and clicking opens a larger version or the
 * rows behind it.
 */

interface TipState {
  x: number;
  y: number;
  /** Below the mark when there's no room above it. */
  below: boolean;
  content: ReactNode;
}

/** Position a tooltip over the hovered element, relative to the chart container. */
export function useChartTip<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((target: Element, content: ReactNode) => {
    const box = containerRef.current?.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (!box) return;
    const y = r.top - box.top;
    setTip({ x: r.left - box.left + r.width / 2, y: y < 56 ? r.bottom - box.top : y, below: y < 56, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { containerRef, tip, show, hide };
}

/** The floating box. Put it inside the (relatively positioned) chart container. */
export function ChartTooltip({ tip, width }: { tip: TipState | null; width?: number }) {
  if (!tip) return null;
  // Keep a 150px-wide box inside the container.
  const x = width ? Math.min(Math.max(tip.x, 80), Math.max(80, width - 80)) : tip.x;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-[16rem] rounded-lg border border-border bg-popover px-3 py-2 text-[12px] text-popover-foreground shadow-lg"
      style={{
        left: x,
        top: tip.y,
        transform: tip.below ? "translate(-50%, 8px)" : "translate(-50%, calc(-100% - 8px))",
      }}
    >
      {tip.content}
    </div>
  );
}

/** Title line plus label/value rows, the standard tooltip body. */
export function TipBody({ title, rows }: { title: ReactNode; rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <div className="space-y-1">
      <div className="font-semibold">{title}</div>
      {rows.map(([label, value], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">
            <bdi dir="ltr">{value}</bdi>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Wraps a compact chart: clicking it (or the expand button that appears on
 * hover) opens a dialog with `expanded`.
 */
export function ExpandableChart({
  title,
  description,
  expanded,
  children,
  className,
}: {
  title: string;
  description?: string;
  expanded: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("charts");
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className={cn("group/chart relative cursor-zoom-in", className)}
        onClick={(e) => {
          // Links and buttons inside the chart keep their own behavior.
          if ((e.target as HTMLElement).closest("a,button")) return;
          setOpen(true);
        }}
      >
        {children}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("expand", { chart: title })}
          title={t("expandHint")}
          className="absolute end-0 top-0 inline-flex size-7 items-center justify-center rounded-md bg-card/80 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity outline-none group-hover/chart:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
          <DialogHeader className="px-6 pt-6 pb-4 pe-12">
            <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="px-6 pb-6">{open ? expanded : null}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
