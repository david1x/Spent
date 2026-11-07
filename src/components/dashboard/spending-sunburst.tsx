"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { BudgetDetailSheet } from "./budget-detail-sheet";
import { formatWhole } from "@/components/home/home-format";
import type { CategoryWithData } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

const SIZE = 320;
const C = SIZE / 2;
const INNER = { r0: 80, r1: 112 } as const;
const OUTER = { r0: 117, r1: 146 } as const;
const GAP_PX = 3;
const CORNER = 4;
const FOLD_SHARE = 0.02;
const OTHER_KEY = "other";

interface Arc {
  key: string;
  groupKey: string;
  ring: "inner" | "outer";
  name: string;
  amount: number;
  color: string;
  categoryId: number | null;
  a0: number;
  a1: number;
}

interface Group {
  key: string;
  name: string;
  amount: number;
  color: string;
  categoryId: number | null;
  leaves: { key: string; name: string; amount: number; color: string; categoryId: number | null }[];
}

interface SpendingSunburstProps {
  categories: CategoryWithData[];
  loading: boolean;
  from: string;
  to: string;
}

function point(r: number, a: number): string {
  // Angle 0 is 12 o'clock and grows clockwise; identical in LTR and RTL.
  return `${(C + r * Math.sin(a)).toFixed(3)} ${(C - r * Math.cos(a)).toFixed(3)}`;
}

/** Annular sector with rounded corners, all four corners convex. */
function sectorPath(a0: number, a1: number, r0: number, r1: number): string {
  const span = a1 - a0;
  if (span <= 0) return "";
  const c = Math.max(0, Math.min(CORNER, (r1 - r0) / 2, (span * r0) / 2.2));
  const da1 = Math.asin(c / (r1 - c));
  const da0 = Math.asin(c / (r0 + c));
  const d1 = Math.sqrt((r1 - c) ** 2 - c ** 2);
  const d0 = Math.sqrt((r0 + c) ** 2 - c ** 2);
  const outerLarge = span - 2 * da1 > Math.PI ? 1 : 0;
  const innerLarge = span - 2 * da0 > Math.PI ? 1 : 0;
  return [
    `M ${point(d1, a0)}`,
    `A ${c} ${c} 0 0 1 ${point(r1, a0 + da1)}`,
    `A ${r1} ${r1} 0 ${outerLarge} 1 ${point(r1, a1 - da1)}`,
    `A ${c} ${c} 0 0 1 ${point(d1, a1)}`,
    `L ${point(d0, a1)}`,
    `A ${c} ${c} 0 0 1 ${point(r0, a1 - da0)}`,
    `A ${r0} ${r0} 0 ${innerLarge} 0 ${point(r0, a0 + da0)}`,
    `A ${c} ${c} 0 0 1 ${point(d0, a0)}`,
    "Z",
  ].join(" ");
}

/** Parent arcs read as a deeper (light) or paler (dark) take on the leaf hue. */
function deepen(color: string): string {
  return `color-mix(in oklch, ${color} 78%, var(--foreground))`;
}

function buildGroups(
  categories: CategoryWithData[],
  otherLabel: string,
  moreIn: (name: string) => string
): { groups: Group[]; total: number } {
  const parents = categories.filter((c) => c.isParent);
  const parentIds = new Set(parents.map((p) => p.categoryId));
  const leaves = categories.filter((c) => !c.isParent && c.spent > 0);
  const total = leaves.reduce((s, c) => s + c.spent, 0);
  if (total <= 0) return { groups: [], total: 0 };

  const raw: Group[] = [];
  for (const p of parents) {
    const kids = leaves
      .filter((l) => l.parentId === p.categoryId)
      .sort((a, b) => b.spent - a.spent);
    const amount = kids.reduce((s, k) => s + k.spent, 0);
    if (amount <= 0) continue;
    raw.push({
      key: `g${p.categoryId}`,
      name: p.categoryName,
      amount,
      color: p.categoryColor,
      categoryId: p.categoryId,
      leaves: kids.map((k) => ({
        key: `l${k.categoryId}`,
        name: k.categoryName,
        amount: k.spent,
        color: k.categoryColor,
        categoryId: k.categoryId,
      })),
    });
  }
  for (const l of leaves) {
    if (l.parentId != null && parentIds.has(l.parentId)) continue;
    raw.push({
      key: `g${l.categoryId}`,
      name: l.categoryName,
      amount: l.spent,
      color: l.categoryColor,
      categoryId: l.categoryId,
      leaves: [
        {
          key: `l${l.categoryId}`,
          name: l.categoryName,
          amount: l.spent,
          color: l.categoryColor,
          categoryId: l.categoryId,
        },
      ],
    });
  }
  raw.sort((a, b) => b.amount - a.amount);

  const kept: Group[] = [];
  const folded: Group[] = [];
  for (const g of raw) {
    (g.amount / total < FOLD_SHARE ? folded : kept).push(g);
  }

  // Within a kept group, tiny leaves merge into one arc so the outer ring
  // stays aligned with its parent instead of jumping to a global "Other".
  for (const g of kept) {
    const big = g.leaves.filter((l) => l.amount / total >= FOLD_SHARE);
    const tiny = g.leaves.filter((l) => l.amount / total < FOLD_SHARE);
    if (tiny.length > 1) {
      g.leaves = [
        ...big,
        {
          key: `${g.key}-more`,
          name: moreIn(g.name),
          amount: tiny.reduce((s, l) => s + l.amount, 0),
          color: g.color,
          categoryId: g.categoryId,
        },
      ];
    }
  }

  if (folded.length === 1) {
    kept.push(folded[0]);
  } else if (folded.length > 1) {
    const amount = folded.reduce((s, g) => s + g.amount, 0);
    kept.push({
      key: OTHER_KEY,
      name: otherLabel,
      amount,
      color: "var(--muted-foreground)",
      categoryId: null,
      leaves: [
        {
          key: `${OTHER_KEY}-leaf`,
          name: otherLabel,
          amount,
          color: "var(--muted-foreground)",
          categoryId: null,
        },
      ],
    });
  }
  return { groups: kept, total };
}

function layoutArcs(groups: Group[], total: number): Arc[] {
  const arcs: Arc[] = [];
  const innerPad = GAP_PX / ((INNER.r0 + INNER.r1) / 2);
  const outerPad = GAP_PX / ((OUTER.r0 + OUTER.r1) / 2);
  const tau = Math.PI * 2;
  let cursor = 0;
  for (const g of groups) {
    const g0 = cursor;
    const g1 = cursor + (g.amount / total) * tau;
    cursor = g1;
    arcs.push({
      key: g.key,
      groupKey: g.key,
      ring: "inner",
      name: g.name,
      amount: g.amount,
      color: g.key === OTHER_KEY ? g.color : deepen(g.color),
      categoryId: g.categoryId,
      a0: g0 + innerPad / 2,
      a1: g1 - innerPad / 2,
    });
    let lc = g0;
    for (const l of g.leaves) {
      const l0 = lc;
      const l1 = lc + (l.amount / g.amount) * (g1 - g0);
      lc = l1;
      arcs.push({
        key: l.key,
        groupKey: g.key,
        ring: "outer",
        name: l.name,
        amount: l.amount,
        color: g.key === OTHER_KEY ? "color-mix(in oklch, var(--muted-foreground) 55%, var(--card))" : l.color,
        categoryId: l.categoryId,
        a0: l0 + outerPad / 2,
        a1: l1 - outerPad / 2,
      });
    }
  }
  return arcs;
}

function pctLabel(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return "<1";
  return String(Math.round(p));
}

export function SpendingSunburst({
  categories,
  loading,
  from,
  to,
}: SpendingSunburstProps) {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { groups, total } = useMemo(
    () =>
      buildGroups(categories, t("sunburstOther"), (name) =>
        t("sunburstMoreIn", { name })
      ),
    [categories, t]
  );
  const arcs = useMemo(() => layoutArcs(groups, total), [groups, total]);

  const active = activeKey ? arcs.find((a) => a.key === activeKey) ?? null : null;
  const isLit = (arc: Arc): boolean => {
    if (!active) return true;
    if (arc.key === active.key) return true;
    if (active.ring === "inner") return arc.groupKey === active.groupKey;
    return arc.ring === "inner" && arc.key === active.groupKey;
  };

  const share = (amount: number) =>
    t("sunburstShare", { pct: pctLabel(total > 0 ? amount / total : 0) });

  // Not memoized: formatWhole reads the live "Hide amounts" flag.
  const summaryLabel = t("sunburstAria", {
    total: formatWhole(total, locale),
    top: groups
      .slice(0, 3)
      .map((g) => `${g.name} ${pctLabel(g.amount / total)}%`)
      .join(", "),
  });

  const open = (arc: Arc) => {
    if (arc.categoryId != null) setSelectedId(arc.categoryId);
  };

  const onArcKey = (e: KeyboardEvent<SVGPathElement>, arc: Arc) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(arc);
    }
  };

  const maxGroup = groups[0]?.amount ?? 0;

  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 md:p-8">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">{t("sunburstTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("sunburstSubtitle")}
        </p>
      </div>

      {loading ? (
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-12">
          <Skeleton className="mx-auto aspect-square w-full max-w-[300px] rounded-full" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 rounded-lg" />
            ))}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-28 w-28 text-muted"
            aria-hidden="true"
          >
            <circle
              cx={C}
              cy={C}
              r={(INNER.r0 + OUTER.r1) / 2}
              fill="none"
              stroke="currentColor"
              strokeWidth={OUTER.r1 - INNER.r0}
            />
          </svg>
          <p className="max-w-xs text-sm text-muted-foreground">
            {t("sunburstEmpty")}
          </p>
        </div>
      ) : (
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-12">
          <div
            className="relative mx-auto aspect-square w-full max-w-[300px]"
            onMouseLeave={() => setActiveKey(null)}
          >
            <svg
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="block h-full w-full overflow-visible"
            >
              <g role="img" aria-label={summaryLabel}>
                <circle
                  cx={C}
                  cy={C}
                  r={(INNER.r0 + OUTER.r1) / 2}
                  fill="none"
                  className="stroke-muted/50"
                  strokeWidth={OUTER.r1 - INNER.r0}
                />
              </g>
              <g>
                {arcs.map((arc) => {
                  const lit = isLit(arc);
                  const grow = active?.key === arc.key;
                  const clickable = arc.categoryId != null;
                  return (
                    <path
                      key={arc.key}
                      d={
                        arc.ring === "inner"
                          ? sectorPath(arc.a0, arc.a1, INNER.r0, INNER.r1)
                          : sectorPath(arc.a0, arc.a1, OUTER.r0, OUTER.r1)
                      }
                      fill={arc.color}
                      tabIndex={0}
                      role={clickable ? "button" : undefined}
                      aria-label={t("sunburstArcAria", {
                        name: arc.name,
                        amount: formatWhole(arc.amount, locale),
                        pct: pctLabel(arc.amount / total),
                      })}
                      onMouseEnter={() => setActiveKey(arc.key)}
                      onFocus={() => setActiveKey(arc.key)}
                      onBlur={() => setActiveKey(null)}
                      onClick={() => open(arc)}
                      onKeyDown={(e) => onArcKey(e, arc)}
                      style={{
                        transformOrigin: `${C}px ${C}px`,
                        transformBox: "view-box",
                        opacity: lit ? 1 : 0.25,
                      }}
                      className={`outline-none transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none focus-visible:[stroke:var(--ring)] focus-visible:[stroke-width:2.5px] ${
                        grow ? "motion-safe:scale-[1.035]" : ""
                      } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                    />
                  );
                })}
              </g>
            </svg>

            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden="true"
            >
              <div className="flex w-[46%] flex-col items-center text-center">
                {active ? (
                  <>
                    <span className="w-full truncate text-xs font-medium text-muted-foreground">
                      {active.name}
                    </span>
                    <span className="mt-0.5 font-sans text-2xl font-semibold tabular-nums tracking-tight sm:text-[1.65rem]">
                      {formatWhole(active.amount, locale)}
                    </span>
                    <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {share(active.amount)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-sans text-[1.75rem] font-semibold leading-tight tabular-nums tracking-tight sm:text-3xl">
                      {formatWhole(total, locale)}
                    </span>
                    <span className="mt-0.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sunburstSpent")}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <ul className="space-y-1" onMouseLeave={() => setActiveKey(null)}>
            {groups.map((g) => {
              const lit = !active || active.groupKey === g.key;
              const swatch = g.key === OTHER_KEY ? g.color : deepen(g.color);
              const clickable = g.categoryId != null;
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onMouseEnter={() => setActiveKey(g.key)}
                    onFocus={() => setActiveKey(g.key)}
                    onBlur={() => setActiveKey(null)}
                    onClick={() =>
                      g.categoryId != null && setSelectedId(g.categoryId)
                    }
                    className={`group w-full rounded-xl px-3 py-2.5 text-start transition-[opacity,background-color] duration-200 motion-reduce:transition-none hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default enabled:cursor-pointer ${
                      lit ? "opacity-100" : "opacity-45"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: swatch }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {g.name}
                      </span>
                      <span className="w-10 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                        {pctLabel(g.amount / total)}%
                      </span>
                      <span className="w-20 shrink-0 text-end font-sans text-sm font-semibold tabular-nums">
                        {formatWhole(g.amount, locale)}
                      </span>
                    </div>
                    <div className="mt-2 ms-5.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${maxGroup > 0 ? Math.max(2, (g.amount / maxGroup) * 100) : 0}%`,
                          background: g.color,
                        }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <BudgetDetailSheet
        categoryId={selectedId}
        from={from}
        to={to}
        onClose={() => setSelectedId(null)}
      />
    </section>
  );
}
