"use client";

import { useTranslations } from "next-intl";
import { Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccess } from "@/components/access-provider";

/** In a viewer's page header: this is someone else's money, to look at. */
export function ViewOnlyBadge() {
  const t = useTranslations("sharing.viewer");
  const { readOnly, ownerName } = useAccess();
  if (!readOnly) return null;
  const hint = ownerName ? t("badgeHintNamed", { owner: ownerName }) : t("badgeHint");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:w-8 max-sm:justify-center max-sm:px-0"
            aria-label={hint}
          />
        }
      >
        <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-sm:sr-only">{t("badge")}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">{hint}</TooltipContent>
    </Tooltip>
  );
}
