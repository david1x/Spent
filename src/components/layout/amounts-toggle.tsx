"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  amountsHidden,
  loadAmountsHidden,
  setAmountsHidden,
  subscribeAmountsHidden,
} from "@/lib/privacy";

/**
 * Subscribes to "Hide amounts". Page components call this so the whole page
 * re-renders, and every formatter runs again, when the switch flips. Local
 * state such as the selected month and filters is kept.
 */
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribeAmountsHidden, amountsHidden, () => false);
}

/** Header eye button that masks every amount in the app. */
export function AmountsToggle() {
  const t = useTranslations("nav");
  const hidden = useAmountsHidden();

  // Apply the saved choice after hydration so the first render matches the server.
  useEffect(() => {
    loadAmountsHidden();
  }, []);

  const label = hidden ? t("showAmounts") : t("hideAmounts");

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={label}
      aria-pressed={hidden}
      title={label}
      onClick={() => {
        setAmountsHidden(!hidden);
      }}
    >
      {hidden ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </Button>
  );
}
