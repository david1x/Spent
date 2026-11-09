import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { accessFor, SESSION_COOKIE } from "@/server/auth";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import {
  SettingsSidebar,
  SettingsMobileNav,
} from "@/components/settings/settings-sidebar";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("settings");
  const tNav = await getTranslations("nav");
  const access = accessFor((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <AppShell>
      <PageHeader title={access?.role === "viewer" ? tNav("account") : t("pageTitle")} />
      <div className="flex min-h-[calc(100vh-4rem)] flex-1">
        <SettingsSidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
            <SettingsMobileNav />
            {children}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
