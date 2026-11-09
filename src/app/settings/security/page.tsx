"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Laptop, Loader2, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SectionShell, SettingCard } from "@/components/settings/section-shell";
import { EnrollFlow, ErrorLine } from "@/components/auth/enroll-flow";
import { CodeInput, RecoveryCodes, useAuthErrorMessage } from "@/components/auth/auth-fields";
import {
  disableSignIn,
  endAuthSession,
  endOtherAuthSessions,
  getAuthStatus,
  listAuthSessions,
  newRecoveryCodes,
  signOut,
  type AuthSession,
} from "@/lib/auth-api";

/** SQLite's datetime('now') is UTC without a zone marker. */
const sqliteDate = (value: string) => new Date(value.replace(" ", "T") + "Z");

/** "Chrome on Windows", from a user agent string. */
function describeBrowser(ua: string | null): string {
  if (!ua) return "Unknown browser";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} · ${os}` : browser;
}

export default function SecuritySettingsPage() {
  const t = useTranslations("auth.settings");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ["auth-status"], queryFn: getAuthStatus });
  const [enrolling, setEnrolling] = useState(false);

  return (
    <SectionShell title={t("title")} description={t("description")}>
      {!status ? (
        <SettingCard>
          <div className="text-sm text-muted-foreground">{tCommon("loading")}</div>
        </SettingCard>
      ) : !status.enabled ? (
        <SettingCard>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <IconTile tone="muted">
              <ShieldOff className="h-4 w-4" />
            </IconTile>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="font-medium">{t("offTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("offHint")}</p>
            </div>
            <Button className="shrink-0 gap-1.5" onClick={() => setEnrolling(true)}>
              <ShieldCheck className="h-4 w-4" />
              {t("turnOn")}
            </Button>
          </div>
        </SettingCard>
      ) : (
        <>
          <SignedInCard username={status.username ?? ""} enabledAt={status.enabledAt ?? null} />
          <RecoveryCard left={status.recoveryCodesLeft ?? 0} />
          <SessionsCard />
          <TurnOffCard />
        </>
      )}
      <SettingCard title={t("domainTitle")} description={t("domainHint")}>
        <ul className="list-disc space-y-1 ps-5 text-xs text-muted-foreground">
          <li>{t("domainHttps")}</li>
          <li>{t("domainRequired")}</li>
          <li>
            {t("domainReset")} <code className="font-mono">npm run auth:reset</code>
          </li>
        </ul>
      </SettingCard>

      <Dialog open={enrolling} onOpenChange={setEnrolling}>
        <DialogContent className="max-w-md">
          <DialogTitle className="font-serif text-xl font-normal">{t("enrollTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{t("enrollHint")}</DialogDescription>
          <div className="pt-2">
            <EnrollFlow
              onDone={() => {
                setEnrolling(false);
                void queryClient.invalidateQueries({ queryKey: ["auth-status"] });
                void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
                toast.success(t("turnedOn"));
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}

function IconTile({ children, tone }: { children: React.ReactNode; tone: "good" | "muted" }) {
  return (
    <div
      className={
        tone === "good"
          ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          : "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

function SignedInCard({ username, enabledAt }: { username: string; enabledAt: string | null }) {
  const t = useTranslations("auth.settings");
  const format = useFormatter();
  const [busy, setBusy] = useState(false);
  return (
    <SettingCard>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <IconTile tone="good">
          <ShieldCheck className="h-4 w-4" />
        </IconTile>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-medium">{t("onTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("onHint", { username })}
            {enabledAt ? ` ${t("onSince", { date: format.dateTime(new Date(enabledAt), { dateStyle: "medium" }) })}` : null}
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0 gap-1.5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await signOut();
            } finally {
              window.location.assign("/login");
            }
          }}
        >
          <LogOut className="h-4 w-4" />
          {t("signOut")}
        </Button>
      </div>
    </SettingCard>
  );
}

function RecoveryCard({ left }: { left: number }) {
  const t = useTranslations("auth.settings");
  const tCommon = useTranslations("common");
  const errorMessage = useAuthErrorMessage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => newRecoveryCodes(code),
    onSuccess: (res) => {
      setCodes(res.recoveryCodes);
      void queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const close = () => {
    setOpen(false);
    setCode("");
    setCodes(null);
    setError(null);
  };

  return (
    <SettingCard title={t("recoveryTitle")} description={t("recoveryHint")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={left <= 2 ? "text-sm font-medium text-destructive" : "text-sm"}>
          {t("recoveryLeft", { count: left })}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <KeyRound className="h-3.5 w-3.5" />
          {t("recoveryNew")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogTitle className="font-serif text-xl font-normal">{t("recoveryNew")}</DialogTitle>
          <DialogDescription className="text-xs">
            {codes ? t("recoveryShownOnce") : t("recoveryConfirmHint")}
          </DialogDescription>
          {codes ? (
            <div className="space-y-4 pt-2">
              <RecoveryCodes codes={codes} />
              <Button className="w-full" onClick={close}>
                {t("done")}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                if (code.length === 6) mutation.mutate();
              }}
            >
              <CodeInput id="recovery-confirm-code" value={code} onChange={setCode} autoFocus />
              <ErrorLine error={error} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close}>
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" className="gap-1.5" disabled={code.length !== 6 || mutation.isPending}>
                  {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("recoveryMake")}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </SettingCard>
  );
}

function SessionsCard() {
  const t = useTranslations("auth.settings");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["auth-sessions"], queryFn: listAuthSessions });
  const sessions = data?.sessions ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
  const endOne = useMutation({ mutationFn: endAuthSession, onSuccess: refresh });
  const endOthers = useMutation({
    mutationFn: endOtherAuthSessions,
    onSuccess: (res) => {
      void refresh();
      toast.success(t("signedOutOthers", { count: res.ended }));
    },
  });
  const others = sessions.filter((s: AuthSession) => !s.current).length;

  return (
    <SettingCard title={t("sessionsTitle")} description={t("sessionsHint")}>
      <ul className="divide-y divide-border">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <Laptop className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="truncate">{describeBrowser(s.userAgent)}</span>
                {s.current ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {t("thisBrowser")}
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-muted-foreground" dir="auto">
                {t("lastActive", { when: format.relativeTime(sqliteDate(s.lastSeenAt)) })}
                {s.ip && s.ip !== "local" ? <span dir="ltr"> · {s.ip}</span> : null}
              </div>
            </div>
            {!s.current ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-foreground"
                disabled={endOne.isPending}
                onClick={() => endOne.mutate(s.id)}
              >
                {t("signOutOne")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {others > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 gap-1.5"
          disabled={endOthers.isPending}
          onClick={() => endOthers.mutate()}
        >
          <LogOut className="h-3.5 w-3.5" />
          {t("signOutOthers")}
        </Button>
      ) : null}
    </SettingCard>
  );
}

function TurnOffCard() {
  const t = useTranslations("auth.settings");
  const tCommon = useTranslations("common");
  const errorMessage = useAuthErrorMessage();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => disableSignIn(password, code),
    onSuccess: () => {
      toast.success(t("turnedOff"));
      window.setTimeout(() => window.location.assign("/settings/security"), 600);
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const close = () => {
    setOpen(false);
    setPassword("");
    setCode("");
    setError(null);
  };

  return (
    <SettingCard title={t("offCardTitle")} description={t("offCardHint")}>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <ShieldOff className="h-3.5 w-3.5" />
        {t("turnOff")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogTitle className="font-serif text-xl font-normal">{t("turnOff")}</DialogTitle>
          <DialogDescription className="text-xs">{t("turnOffConfirmHint")}</DialogDescription>
          <form
            className="space-y-3 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (password && code.length === 6) mutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="turnoff-password" className="text-xs text-muted-foreground">
                {t("password")}
              </Label>
              <Input
                id="turnoff-password"
                type="password"
                autoComplete="current-password"
                value={password}
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="turnoff-code" className="text-xs text-muted-foreground">
                {t("code")}
              </Label>
              <CodeInput id="turnoff-code" value={code} onChange={setCode} />
            </div>
            <ErrorLine error={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="gap-1.5"
                disabled={!password || code.length !== 6 || mutation.isPending}
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("turnOff")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingCard>
  );
}
