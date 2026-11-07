"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { HomeNeedsAttention } from "@/lib/types";
import { CardShell } from "./card-shell";

interface Props {
  data: HomeNeedsAttention;
}

const strong = (chunks: ReactNode) => (
  <b className="font-medium text-foreground">{chunks}</b>
);

export function NeedsAttentionCard({ data }: Props) {
  const t = useTranslations("home");
  const { uncategorized, lowConfidence, flagged, total } = data;

  if (total === 0) {
    return (
      <CardShell label={t("toReview")}>
        <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
          <CircleCheck className="size-4 text-primary" aria-hidden />
          {t("allCaughtUp")}
        </div>
      </CardShell>
    );
  }

  const parts: string[] = [];
  if (lowConfidence > 0) parts.push(t("reviewLowConfidence", { count: lowConfidence }));
  if (uncategorized > 0) parts.push(t("reviewUncategorized", { count: uncategorized }));
  if (flagged > 0) parts.push(t("reviewFlagged", { count: flagged }));

  const sentence =
    parts.length >= 3
      ? t.rich("reviewSentence3", { a: parts[0], b: parts[1], c: parts[2], strong })
      : parts.length === 2
        ? t.rich("reviewSentence2", { a: parts[0], b: parts[1], strong })
        : t.rich("reviewSentence1", { a: parts[0] ?? "", strong });

  return (
    <CardShell label={t("toReview")}>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <span className="font-serif text-[2.375rem] font-medium leading-none tabular-nums">
          {total}
        </span>
        <p className="min-w-[10rem] flex-1 text-[13px] text-muted-foreground">{sentence}</p>
        <Link href="/transactions?review=1" className={buttonVariants({ size: "sm" })}>
          {t("review")}
        </Link>
      </div>
    </CardShell>
  );
}
