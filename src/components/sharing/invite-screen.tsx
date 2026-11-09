"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, LinkIcon, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { EnrollFlow } from "@/components/auth/enroll-flow";
import { finishInviteEnrollment, signOut, startInviteEnrollment, type InviteInfo } from "@/lib/auth-api";

/**
 * The invite link's page: who shared what, then the same three steps as the
 * owner's sign-in (name and password, authenticator, recovery codes).
 */
export function InviteScreen({
  token,
  invite,
  signedInAs,
}: {
  token: string;
  invite: InviteInfo | null;
  /** Someone is already signed in on this browser. */
  signedInAs: string | null;
}) {
  const t = useTranslations("sharing.invite");
  const [signingOut, setSigningOut] = useState(false);

  let body: React.ReactNode;
  if (!invite) {
    body = (
      <Message icon={<LinkIcon className="h-5 w-5" />} title={t("goneTitle")} hint={t("goneHint")}>
        <Button variant="outline" className="w-full" onClick={() => window.location.assign("/login")}>
          {t("toSignIn")}
        </Button>
      </Message>
    );
  } else if (signedInAs !== null) {
    body = (
      <Message
        icon={<LogOut className="h-5 w-5" />}
        title={t("signedInTitle")}
        hint={t("signedInHint", { name: signedInAs })}
      >
        <Button
          className="w-full gap-1.5"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              await signOut();
            } finally {
              window.location.reload();
            }
          }}
        >
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("signOutAndJoin")}
        </Button>
      </Message>
    );
  } else {
    const owner = invite.ownerName ?? t("someone");
    body = (
      <>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Eye className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-3xl leading-tight tracking-tight text-balance">{t("title", { owner })}</h1>
          <p className="mx-auto mt-2 max-w-[360px] text-sm text-muted-foreground text-pretty">
            {t("hint", { owner })}
          </p>
          {invite.workspaces.length > 0 ? (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {invite.workspaces.map((name) => (
                <span key={name} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium">
                  <bdi>{name}</bdi>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <EnrollFlow
            start={(username, password) => startInviteEnrollment(token, username, password)}
            finish={finishInviteEnrollment}
            onDone={() => window.location.assign("/")}
          />
        </div>
        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">{t("footer", { owner })}</p>
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl px-6 py-6 md:px-8">
        <BrandMark />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-10">
        <div className="w-full max-w-[420px]">{body}</div>
      </main>
    </div>
  );
}

function Message({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <h1 className="font-serif text-2xl leading-tight tracking-tight">{title}</h1>
      <p className="mx-auto mb-5 mt-2 max-w-[320px] text-sm text-muted-foreground text-pretty">{hint}</p>
      {children}
    </div>
  );
}
