"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArchiveRestore, ArrowLeft, ArrowRight, Landmark } from "lucide-react";
import { RestoreBackup } from "@/components/settings/backup-card";

/**
 * The first screen of a new install: set Spent up from scratch, or bring
 * everything over from a backup (another computer, or a move into Docker).
 */
export function WelcomeStep({ onStartFresh }: { onStartFresh: () => void }) {
  const t = useTranslations("setup.welcome");
  const [restoring, setRestoring] = useState(false);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-4 pt-8 text-center">
      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("eyebrow")}</div>
      <h1 className="max-w-[480px] font-serif text-4xl leading-[1.08] tracking-tight">
        {restoring ? t("restoreTitle") : t("title")}
      </h1>
      <p className="max-w-[420px] text-sm leading-relaxed text-muted-foreground">
        {restoring ? t("restoreSubtitle") : t("subtitle")}
      </p>

      {restoring ? (
        <div className="mt-4 w-full max-w-[440px] space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 text-start shadow-sm">
            <RestoreBackup heading={false} />
          </div>
          <button
            type="button"
            onClick={() => setRestoring(false)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
            {t("back")}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid w-full gap-3 sm:grid-cols-2">
          <Choice
            icon={<Landmark className="h-5 w-5" />}
            title={t("freshTitle")}
            hint={t("freshHint")}
            cta={t("freshCta")}
            primary
            onClick={onStartFresh}
          />
          <Choice
            icon={<ArchiveRestore className="h-5 w-5" />}
            title={t("restoreChoiceTitle")}
            hint={t("restoreChoiceHint")}
            cta={t("restoreCta")}
            onClick={() => setRestoring(true)}
          />
        </div>
      )}
    </div>
  );
}

function Choice({
  icon,
  title,
  hint,
  cta,
  primary = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  cta: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (primary ? "border-primary/40 hover:border-primary" : "border-border hover:border-foreground/30")
      }
    >
      <div
        className={
          "flex h-10 w-10 items-center justify-center rounded-xl " +
          (primary ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")
        }
      >
        {icon}
      </div>
      <div className="space-y-1">
        <div className="font-medium">{title}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-semibold text-foreground/80 group-hover:text-foreground">
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
      </span>
    </button>
  );
}
