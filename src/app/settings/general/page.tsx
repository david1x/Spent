"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input, InputGroup } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionShell, SettingCard } from "@/components/settings/section-shell";
import { WorkspaceNameCard } from "@/components/settings/workspace-controls";
import { RefreshCw } from "lucide-react";
import { getFxStatus, getSettings, getSummary, updateFxRates, updateSettings } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStartLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function GeneralSettingsPage() {
  const t = useTranslations("settings.general");
  const tCommon = useTranslations("common");
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const { data: summary } = useQuery({
    queryKey: ["summary", monthStartLocalISO(), todayLocalISO()],
    queryFn: () => getSummary({ from: monthStartLocalISO(), to: todayLocalISO() }),
  });

  return (
    <SectionShell title={t("title")} description={t("description")}>
      <WorkspaceNameCard />
      {settings ? (
        <>
          <MonthlyTargetCard
            key={`target:${settings.monthlyTarget ?? "null"}`}
            initialTarget={settings.monthlyTarget}
            typicalMonthly={summary?.typicalMonthly ?? null}
          />
          <GeneralForm
            key={settings.monthsToSync + ":" + settings.paydayDay + ":" + settings.budgetPeriod}
            initialMonths={settings.monthsToSync}
            initialPayday={settings.paydayDay}
            initialBudgetPeriod={settings.budgetPeriod}
          />
          <AutoSyncCard
            key={`auto:${settings.autoSyncEnabled}:${settings.autoSyncTime}`}
            initialEnabled={settings.autoSyncEnabled}
            initialTime={settings.autoSyncTime}
          />
          <ExchangeRatesCard />
        </>
      ) : (
        <SettingCard>
          <div className="text-sm text-muted-foreground">{tCommon("loading")}</div>
        </SettingCard>
      )}
    </SectionShell>
  );
}

function MonthlyTargetCard({
  initialTarget,
  typicalMonthly,
}: {
  initialTarget: number | null;
  typicalMonthly: number | null;
}) {
  const t = useTranslations("settings.general");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const [value, setValue] = useState(
    initialTarget != null ? String(initialTarget) : ""
  );

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      toast.success(tCommon("saved"));
    },
  });

  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed == null || (Number.isFinite(parsed) && parsed >= 0);
  const dirty =
    (parsed ?? null) !== (initialTarget ?? null) && valid;

  return (
    <div id="section-monthly-target">
      <SettingCard
        title={t("monthlyTargetTitle")}
        description={t("monthlyTargetDescription")}
      >
        <div className="space-y-2 max-w-xs">
          <Label htmlFor="monthly-target">{t("monthlyTargetLabel")}</Label>
          <InputGroup prefix="₪">
            <Input
              id="monthly-target"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder={t("monthlyTargetPlaceholder")}
              className="text-end tabular-nums"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </InputGroup>
          {typicalMonthly != null ? (
            <p className="text-[11px] text-muted-foreground">
              {t("typicalLast3", {
                amount: formatCurrency(typicalMonthly, "ILS", locale),
              })}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {t("noPriorHistory")}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            onClick={() =>
              mutation.mutate({ monthlyTarget: parsed })
            }
            disabled={!dirty || mutation.isPending}
          >
            {mutation.isPending ? tCommon("saving") : tCommon("saveChanges")}
          </Button>
        </div>
      </SettingCard>
    </div>
  );
}

function GeneralForm({
  initialMonths,
  initialPayday,
  initialBudgetPeriod,
}: {
  initialMonths: number;
  initialPayday: number;
  initialBudgetPeriod: "calendar" | "payday";
}) {
  const t = useTranslations("settings.general");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [months, setMonths] = useState(String(initialMonths));
  const [paydayDay, setPaydayDay] = useState(String(initialPayday));
  const [budgetPeriod, setBudgetPeriod] = useState(initialBudgetPeriod);

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      // The period setting moves every range in the app, so refresh it all.
      queryClient.invalidateQueries();
      toast.success(tCommon("saved"));
    },
  });

  const dirty =
    Number(months) !== initialMonths ||
    Number(paydayDay) !== initialPayday ||
    budgetPeriod !== initialBudgetPeriod;

  return (
    <SettingCard
      title={t("syncWindowTitle")}
      description={t("syncWindowDescription")}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground/80">
            {t("monthsToSync")}
          </div>
          <Select value={months} onValueChange={(v) => v && setMonths(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 6, 12].map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} {m === 1 ? tCommon("month") : tCommon("months")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t("banksLimit")}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground/80">{t("payday")}</div>
          <Select value={paydayDay} onValueChange={(v) => v && setPaydayDay(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t("ordinalOfMonth", { ordinal: String(d) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t("paydayHint")}
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <div className="text-xs font-medium text-foreground/80">{t("budgetPeriod")}</div>
          <Select
            value={budgetPeriod}
            onValueChange={(v) => {
              if (v === "calendar" || v === "payday") setBudgetPeriod(v);
            }}
          >
            <SelectTrigger className="sm:max-w-sm">
              <SelectValue>
                {(value: string) =>
                  value === "payday"
                    ? t("budgetPeriodPayday", { day: paydayDay })
                    : t("budgetPeriodCalendar")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="calendar">{t("budgetPeriodCalendar")}</SelectItem>
              <SelectItem value="payday">{t("budgetPeriodPayday", { day: paydayDay })}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t("budgetPeriodHint")}</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button
          onClick={() =>
            mutation.mutate({
              monthsToSync: Number(months),
              paydayDay: Number(paydayDay),
              budgetPeriod,
            })
          }
          disabled={!dirty || mutation.isPending}
        >
          {mutation.isPending ? tCommon("saving") : tCommon("saveChanges")}
        </Button>
      </div>
    </SettingCard>
  );
}

function AutoSyncCard({
  initialEnabled,
  initialTime,
}: {
  initialEnabled: boolean;
  initialTime: string;
}) {
  const t = useTranslations("settings.general");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [time, setTime] = useState(initialTime);

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      toast.success(tCommon("saved"));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("failedToSave"));
    },
  });

  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const dirty =
    timeValid && (enabled !== initialEnabled || time !== initialTime);

  return (
    <SettingCard
      title={t("autoSyncTitle")}
      description={t("autoSyncDescription")}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="auto-sync-toggle" className="text-sm font-medium">
            {t("dailyAutoSync")}
          </Label>
          <p className="text-[11px] text-muted-foreground">
            {t("runsInIsraelTime")}
          </p>
        </div>
        <Switch
          id="auto-sync-toggle"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>
      <div className="mt-5 grid gap-2 sm:max-w-xs">
        <Label htmlFor="auto-sync-time" className="text-xs font-medium text-foreground/80">
          {t("timeOfDay")}
        </Label>
        <Input
          id="auto-sync-time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          disabled={!enabled}
          className="tabular-nums"
        />
        <p className="text-[11px] text-muted-foreground">
          {t("timeOfDayHint")}
        </p>
      </div>
      <div className="mt-5 flex justify-end">
        <Button
          onClick={() =>
            mutation.mutate({ autoSyncEnabled: enabled, autoSyncTime: time })
          }
          disabled={!dirty || mutation.isPending}
        >
          {mutation.isPending ? tCommon("saving") : tCommon("saveChanges")}
        </Button>
      </div>
    </SettingCard>
  );
}

/** Rates older than this get a nudge to update. */
const FX_STALE_DAYS = 7;

/**
 * Local Bank of Israel rates behind the shekel estimates for foreign
 * purchases a card bills in their own currency.
 */
function ExchangeRatesCard() {
  const t = useTranslations("settings.general");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["fx-status"], queryFn: getFxStatus });

  const update = useMutation({
    mutationFn: updateFxRates,
    onSuccess: (result) => {
      queryClient.setQueryData(["fx-status"], result.status);
      if (result.changed > 0) {
        for (const key of ["transactions", "summary", "transactions-summary", "home", "transaction-history", "category-detail"]) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
      toast.success(
        result.latestDate
          ? t("fxUpdated", { date: formatDay(result.latestDate, locale), count: result.changed })
          : t("fxUpToDate")
      );
    },
    onError: () => toast.error(t("fxUpdateFailed")),
  });

  const latest = status.data?.latestDate ?? null;
  const ageDays = latest
    ? Math.floor((Date.parse(todayLocalISO()) - Date.parse(latest)) / 86_400_000)
    : null;
  const stale = ageDays !== null && ageDays > FX_STALE_DAYS;

  return (
    <SettingCard title={t("fxTitle")} description={t("fxDescription")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-0.5 text-sm">
          {status.data ? (
            <>
              <div className="font-medium">
                {latest
                  ? t("fxThrough", { date: formatDay(latest, locale) })
                  : t("fxNone")}
              </div>
              <div className={stale ? "text-xs text-amber-700 dark:text-amber-400" : "text-xs text-muted-foreground"}>
                {/* Each part isolated so Latin codes and numbers keep their order in Hebrew. */}
                {[
                  stale ? t("fxStale", { count: ageDays ?? 0 }) : null,
                  status.data.currencies.join(", "),
                  t("fxEstimatedCount", { count: status.data.estimatedCount }),
                ]
                  .filter(Boolean)
                  .map((part, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : null}
                      <bdi>{part}</bdi>
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">…</div>
          )}
        </div>
        <Button
          variant={stale ? "default" : "outline"}
          onClick={() => update.mutate()}
          disabled={update.isPending}
          className="shrink-0"
        >
          <RefreshCw className={update.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {update.isPending ? t("fxUpdating") : t("fxUpdate")}
        </Button>
      </div>
    </SettingCard>
  );
}

function formatDay(day: string, locale: Locale): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale === "he" ? "he-IL" : "en-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
