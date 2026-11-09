import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnforced, SESSION_COOKIE, validateSession } from "@/server/auth";

/**
 * Runs before every request (Node.js runtime). Two jobs:
 *
 * 1. Same-origin enforcement for mutating API requests. Any webpage you visit
 *    can fire a POST at http://127.0.0.1:4005/api/sync from inside your
 *    browser; requests whose Origin or Referer isn't the app itself are
 *    rejected, so a malicious tab can't sync, delete or recategorize.
 *
 * 2. Sign-in, when it's on (Settings, Security) or the server requires it
 *    (SPENT_AUTH_REQUIRED=1): without a valid session, pages go to /login and
 *    API calls get a 401.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Reachable without a session: the sign-in page and what it calls. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/health",
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/verify",
  "/api/auth/logout",
  "/api/auth/enroll",
  "/api/auth/enroll/confirm",
]);

function crossOriginBlock(request: NextRequest): NextResponse | null {
  if (!MUTATING_METHODS.has(request.method) || !request.nextUrl.pathname.startsWith("/api/")) {
    return null;
  }
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");

  // A mutating call from a browser always carries one of the two.
  if (!origin && !referer) {
    return new NextResponse("Forbidden: missing origin/referer", { status: 403 });
  }
  const sameHost = (value: string): boolean => {
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  if (origin && !sameHost(origin)) {
    return new NextResponse("Forbidden: cross-origin request blocked", { status: 403 });
  }
  if (!origin && referer && !sameHost(referer)) {
    return new NextResponse("Forbidden: cross-origin referer", { status: 403 });
  }
  return null;
}

function authBlock(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || !isAuthEnforced()) return null;
  if (validateSession(request.cookies.get(SESSION_COOKIE)?.value)) return null;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { code: "signed_out", message: "Sign in to continue." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export function proxy(request: NextRequest) {
  return crossOriginBlock(request) ?? authBlock(request) ?? NextResponse.next();
}

export const config = {
  // Everything but build assets and public images, which hold nothing private.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|webmanifest)$).*)"],
};
