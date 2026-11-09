import type { Metadata } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { getLocale, getMessages } from "next-intl/server";
import { I18nProvider } from "@/i18n/client-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/query-provider";
import { AccessProvider, type ClientAccess } from "@/components/access-provider";
import { accessFor, isAuthEnabled, ownerName, SESSION_COOKIE } from "@/server/auth";
import { dirFor, isLocale, defaultLocale } from "@/i18n/routing";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spent",
  description: "Personal finance tracker with AI-powered categorization",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const messages = await getMessages();
  const dir = dirFor(locale);
  const access = accessFor((await cookies()).get(SESSION_COOKIE)?.value);
  const clientAccess: ClientAccess = {
    role: access?.role ?? "owner",
    username: access?.username ?? null,
    ownerName: ownerName(),
    signInOn: isAuthEnabled(),
  };
  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale} messages={messages as Record<string, unknown>}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <AccessProvider value={clientAccess}>
              <QueryProvider>
                <TooltipProvider>
                  {children}
                  <Toaster />
                </TooltipProvider>
              </QueryProvider>
            </AccessProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
