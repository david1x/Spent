"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { finishEnrollment, startEnrollment, type EnrollStart } from "@/lib/auth-api";
import { CodeInput, RecoveryCodes, useAuthErrorMessage } from "./auth-fields";

/** Matches MIN_PASSWORD_LENGTH in src/server/auth/index.ts. */
const MIN_PASSWORD = 10;

type Stage =
  | { kind: "account" }
  | { kind: "scan"; enrollmentId: string; secret: string; qr: string }
  | { kind: "codes"; codes: string[] };

/**
 * Turning sign-in on: a name and password, and if the person wants it, an
 * authenticator app (scan and confirm a code) and its recovery codes. Nothing
 * is saved until the last step; after that this browser is already signed in.
 */
export function EnrollFlow({
  onDone,
  start = startEnrollment,
  finish = finishEnrollment,
}: {
  onDone: () => void;
  /** Step one and two; an invite link passes its own (see /invite). */
  start?: (username: string, password: string, twoFactor: boolean) => Promise<EnrollStart>;
  finish?: (enrollmentId: string, code: string) => Promise<{ recoveryCodes: string[] }>;
}) {
  const t = useTranslations("auth.enroll");
  const errorMessage = useAuthErrorMessage();
  const [stage, setStage] = useState<Stage>({ kind: "account" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [twoFactor, setTwoFactor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const accountReady = username.trim().length > 0 && password.length >= MIN_PASSWORD && confirm === password;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (stage.kind === "account") {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!accountReady) return;
          void run(async () => {
            const res = await start(username, password, twoFactor);
            if ("done" in res) onDone();
            else setStage({ kind: "scan", ...res });
          });
        }}
      >
        <StepLabel n={1} total={twoFactor ? 3 : 1} text={t("stepAccount")} />
        <div className="space-y-1.5">
          <Label htmlFor="enroll-name" className="text-xs text-muted-foreground">{t("username")}</Label>
          <Input
            id="enroll-name"
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            maxLength={64}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="enroll-password" className="text-xs text-muted-foreground">{t("password")}</Label>
          <Input
            id="enroll-password"
            type="password"
            autoComplete="new-password"
            value={password}
            aria-invalid={tooShort}
            onChange={(e) => setPassword(e.target.value)}
          />
          {tooShort ? <p className="text-[11px] text-destructive">{t("tooShort", { min: MIN_PASSWORD })}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="enroll-confirm" className="text-xs text-muted-foreground">{t("confirm")}</Label>
          <Input
            id="enroll-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={mismatch}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch ? <p className="text-[11px] text-destructive">{t("mismatch")}</p> : null}
        </div>
        <label
          htmlFor="enroll-two-factor"
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 p-3"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{t("twoFactorLabel")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("twoFactorHint")}</span>
          </span>
          <Switch
            id="enroll-two-factor"
            className="mt-0.5"
            checked={twoFactor}
            onCheckedChange={(v) => setTwoFactor(v)}
          />
        </label>
        <ErrorLine error={error} />
        <Button type="submit" disabled={!accountReady || busy} className="w-full gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {twoFactor ? t("continue") : t("create")}
        </Button>
      </form>
    );
  }

  if (stage.kind === "scan") {
    return (
      <ScanStep
        stepLabel={<StepLabel n={2} total={3} text={t("stepScan")} />}
        qr={stage.qr}
        secret={stage.secret}
        onBack={() => setStage({ kind: "account" })}
        onVerify={async (code) => {
          const res = await finish(stage.enrollmentId, code);
          setStage({ kind: "codes", codes: res.recoveryCodes });
        }}
      />
    );
  }

  return <CodesStep stepLabel={<StepLabel n={3} total={3} text={t("stepCodes")} />} codes={stage.codes} onDone={onDone} />;
}

/** The QR code and manual key, then a code from the app to confirm it. */
export function ScanStep({
  stepLabel,
  qr,
  secret,
  onBack,
  onVerify,
  verifyLabel,
}: {
  stepLabel?: React.ReactNode;
  qr: string;
  secret: string;
  onBack: () => void;
  onVerify: (code: string) => Promise<void>;
  verifyLabel?: string;
}) {
  const t = useTranslations("auth.enroll");
  const errorMessage = useAuthErrorMessage();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (code.length !== 6) return;
        setBusy(true);
        setError(null);
        try {
          await onVerify(code);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {stepLabel}
      <p className="text-sm text-muted-foreground">{t("scanHint")}</p>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <img
          src={qr}
          alt={t("qrAlt")}
          width={168}
          height={168}
          className="shrink-0 rounded-xl border border-border bg-white p-2"
        />
        <div className="min-w-0 space-y-1.5 text-start">
          <div className="text-xs text-muted-foreground">{t("manualKey")}</div>
          <code dir="ltr" className="block select-all break-all rounded-lg bg-muted px-2.5 py-2 font-mono text-xs leading-relaxed">
            {secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="enroll-code" className="text-xs text-muted-foreground">{t("codeLabel")}</Label>
        <CodeInput id="enroll-code" value={code} onChange={setCode} autoFocus disabled={busy} />
      </div>
      <ErrorLine error={error} />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          {t("back")}
        </Button>
        <Button type="submit" disabled={code.length !== 6 || busy} className="flex-1 gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {verifyLabel ?? t("verify")}
        </Button>
      </div>
    </form>
  );
}

/** New recovery codes, which have to be saved before going on. */
export function CodesStep({
  stepLabel,
  codes,
  onDone,
}: {
  stepLabel?: React.ReactNode;
  codes: string[];
  onDone: () => void;
}) {
  const t = useTranslations("auth.enroll");
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-4">
      {stepLabel}
      <p className="text-sm text-muted-foreground">{t("codesHint")}</p>
      <RecoveryCodes codes={codes} />
      <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t("savedCheck")}</span>
      </label>
      <Button className="w-full" disabled={!saved} onClick={onDone}>
        {t("finish")}
      </Button>
    </div>
  );
}

function StepLabel({ n, total, text }: { n: number; total: number; text: string }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {total > 1 ? `${n} / ${total} · ` : ""}
      {text}
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}
