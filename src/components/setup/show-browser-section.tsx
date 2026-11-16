"use client";

import { useTranslations } from "next-intl";
import { AppWindow } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { BankProviderInfo } from "@/lib/types";

interface ShowBrowserSectionProps {
  info: BankProviderInfo;
  showBrowser: boolean;
  onChange: (next: boolean) => void;
}

/** Per-login choice to sync in a visible browser window instead of headless. */
export function ShowBrowserSection({ info, showBrowser, onChange }: ShowBrowserSectionProps) {
  const t = useTranslations("settings.bank");
  const id = `${info.id}-show-browser`;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <AppWindow className="h-3.5 w-3.5" />
        {t("showBrowserTitle")}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-medium">
          {t("showBrowserLabel")}
        </Label>
        <Switch id={id} checked={showBrowser} onCheckedChange={onChange} />
      </div>
      <p className="text-[11px] text-muted-foreground">{t("showBrowserHint")}</p>
    </div>
  );
}
