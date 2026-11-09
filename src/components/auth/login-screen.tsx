"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { EnrollFlow } from "./enroll-flow";
import { SignInForm } from "./sign-in-form";

/**
 * The sign-in screen. "create" appears only when the server requires sign-in
 * (SPENT_AUTH_REQUIRED=1) and no account exists yet.
 */
export function LoginScreen({ mode, next }: { mode: "sign-in" | "create"; next: string }) {
  const t = useTranslations("auth.screen");
  const [recoveryNotice, setRecoveryNotice] = useState<number | null>(null);
  // A full load, so every page starts fresh with the new session cookie.
  const go = () => window.location.assign(next);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl px-6 py-6 md:px-8">
        <BrandMark />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {mode === "create" ? <ShieldCheck className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
            </div>
            <h1 className="font-serif text-3xl leading-tight tracking-tight">
              {mode === "create" ? t("createTitle") : t("signInTitle")}
            </h1>
            <p className="mx-auto mt-2 max-w-[340px] text-sm text-muted-foreground">
              {mode === "create" ? t("createHint") : t("signInHint")}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            {recoveryNotice !== null ? (
              <div className="space-y-4">
                <p className="text-sm">{t("usedRecovery", { count: recoveryNotice })}</p>
                <Button className="w-full" onClick={go}>
                  {t("continue")}
                </Button>
              </div>
            ) : mode === "create" ? (
              <EnrollFlow onDone={go} />
            ) : (
              <SignInForm
                onSignedIn={({ usedRecoveryCode, recoveryCodesLeft }) => {
                  if (usedRecoveryCode) setRecoveryNotice(recoveryCodesLeft);
                  else go();
                }}
              />
            )}
          </div>
          {mode === "sign-in" ? (
            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">{t("lockedOut")}</p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
