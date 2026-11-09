"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { finishLogin, startLogin } from "@/lib/auth-api";
import { CodeInput, codeReady, useAuthErrorMessage } from "./auth-fields";
import { ErrorLine } from "./enroll-flow";

/** Name and password, then a code from the authenticator app (or a recovery code). */
export function SignInForm({ onSignedIn }: { onSignedIn: (info: { recoveryCodesLeft: number; usedRecoveryCode: boolean }) => void }) {
  const t = useTranslations("auth.signIn");
  const errorMessage = useAuthErrorMessage();
  const [ticket, setTicket] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      // An expired ticket means starting over from the password.
      if (err instanceof Error && "code" in err && err.code === "expired") {
        setTicket(null);
        setCode("");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!ticket) {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!username.trim() || !password) return;
          void run(async () => {
            const res = await startLogin(username, password);
            setPassword("");
            setTicket(res.ticket);
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="signin-name" className="text-xs text-muted-foreground">{t("username")}</Label>
          <Input
            id="signin-name"
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signin-password" className="text-xs text-muted-foreground">{t("password")}</Label>
          <Input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <ErrorLine error={error} />
        <Button type="submit" className="w-full gap-1.5" disabled={!username.trim() || !password || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("continue")}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!codeReady(code, recovery)) return;
        void run(async () => {
          const res = await finishLogin(ticket, code);
          onSignedIn(res);
        });
      }}
    >
      <p className="text-sm text-muted-foreground">{recovery ? t("recoveryHint") : t("codeHint")}</p>
      <div className="space-y-1.5">
        <Label htmlFor="signin-code" className="text-xs text-muted-foreground">
          {recovery ? t("recoveryLabel") : t("codeLabel")}
        </Label>
        <CodeInput id="signin-code" value={code} onChange={setCode} recovery={recovery} autoFocus disabled={busy} />
      </div>
      <ErrorLine error={error} />
      <Button type="submit" className="w-full gap-1.5" disabled={!codeReady(code, recovery) || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {t("signIn")}
      </Button>
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            setRecovery((r) => !r);
            setCode("");
            setError(null);
          }}
        >
          {recovery ? t("useApp") : t("useRecovery")}
        </button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            setTicket(null);
            setCode("");
            setError(null);
          }}
        >
          {t("startOver")}
        </button>
      </div>
    </form>
  );
}
