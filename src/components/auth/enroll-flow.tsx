"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { finishEnrollment, startEnrollment } from "@/lib/auth-api";
import { CodeInput, RecoveryCodes, useAuthErrorMessage } from "./auth-fields";

/** Matches MIN_PASSWORD_LENGTH in src/server/auth/index.ts. */
const MIN_PASSWORD = 10;

type Stage =
  | { kind: "account" }
  | { kind: "scan"; enrollmentId: string; secret: string; qr: string }
  | { kind: "codes"; codes: string[] };

/**
 * Turning sign-in on: a name and password, then the authenticator app (scan
 * and confirm a code), then the recovery codes. Nothing is saved until the
 * code is confirmed; after that this browser is already signed in.
 */
export function EnrollFlow({ onDone }: { onDone: () => void }) {
  const t = useTranslations("auth.enroll");
  const errorMessage = useAuthErrorMessage();
  const [stage, setStage] = useState<Stage>({ kind: "account" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
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
            const res = await startEnrollment(username, password);
            setStage({ kind: "scan", ...res });
          });
        }}
      >
        <StepLabel n={1} text={t("stepAccount")} />
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
        <ErrorLine error={error} />
        <Button type="submit" disabled={!accountReady || busy} className="w-full gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("continue")}
        </Button>
      </form>
    );
  }

  if (stage.kind === "scan") {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length !== 6) return;
          void run(async () => {
            const res = await finishEnrollment(stage.enrollmentId, code);
            setStage({ kind: "codes", codes: res.recoveryCodes });
          });
        }}
      >
        <StepLabel n={2} text={t("stepScan")} />
        <p className="text-sm text-muted-foreground">{t("scanHint")}</p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <img
            src={stage.qr}
            alt={t("qrAlt")}
            width={168}
            height={168}
            className="shrink-0 rounded-xl border border-border bg-white p-2"
          />
          <div className="min-w-0 space-y-1.5 text-start">
            <div className="text-xs text-muted-foreground">{t("manualKey")}</div>
            <code dir="ltr" className="block select-all break-all rounded-lg bg-muted px-2.5 py-2 font-mono text-xs leading-relaxed">
              {stage.secret.replace(/(.{4})/g, "$1 ").trim()}
            </code>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="enroll-code" className="text-xs text-muted-foreground">{t("codeLabel")}</Label>
          <CodeInput id="enroll-code" value={code} onChange={setCode} autoFocus disabled={busy} />
        </div>
        <ErrorLine error={error} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStage({ kind: "account" });
              setCode("");
              setError(null);
            }}
            disabled={busy}
          >
            {t("back")}
          </Button>
          <Button type="submit" disabled={code.length !== 6 || busy} className="flex-1 gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("verify")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <StepLabel n={3} text={t("stepCodes")} />
      <p className="text-sm text-muted-foreground">{t("codesHint")}</p>
      <RecoveryCodes codes={stage.codes} />
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

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {n} / 3 · {text}
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
