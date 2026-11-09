import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthEnabled, isAuthEnforced, SESSION_COOKIE, validateSession } from "@/server/auth";
import { LoginScreen } from "@/components/auth/login-screen";

export const dynamic = "force-dynamic";

/** Only same-site paths, so the sign-in page can't be used to bounce people elsewhere. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (!isAuthEnforced()) redirect(next);
  const store = await cookies();
  if (validateSession(store.get(SESSION_COOKIE)?.value)) redirect(next);
  return <LoginScreen mode={isAuthEnabled() ? "sign-in" : "create"} next={next} />;
}
