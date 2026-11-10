import { NextResponse, type NextRequest } from "next/server";
import { accessFor, isAuthEnforced, SESSION_COOKIE, type Access } from "@/server/auth";

/**
 * Runs before every request (Node.js runtime). Three jobs:
 *
 * 1. Same-origin enforcement for mutating API requests. Any webpage you visit
 *    can fire a POST at http://127.0.0.1:4005/api/sync from inside your
 *    browser; requests whose Origin or Referer isn't the app itself are
 *    rejected, so a malicious tab can't sync, delete or recategorize.
 *
 * 2. Sign-in, when it's on (Settings, Security) or the server requires it
 *    (SPENT_AUTH_REQUIRED=1): without a valid session, pages go to /login and
 *    API calls get a 401.
 *
 * 3. People the owner shared with (viewers): only the pages and read-only
 *    API calls listed below, only in the workspaces shared with them. The one
 *    thing they can write is a category suggestion for the owner to approve.
 *    Anything not listed is closed to them, so a new route starts out closed.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Reachable without a session: the sign-in page, invite links and what they call. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/health",
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/verify",
  "/api/auth/logout",
  "/api/auth/enroll",
  "/api/auth/enroll/confirm",
  "/api/invites/confirm",
]);
const PUBLIC_PREFIXES = ["/invite/", "/api/invites/"];

const VIEWER_PAGES: RegExp[] = [
  /^\/$/,
  /^\/budget(\/|$)/,
  /^\/insights(\/|$)/,
  /^\/transactions(\/|$)/,
  /^\/settings\/security$/,
];

const VIEWER_READS: RegExp[] = [
  /^\/api\/activity$/,
  /^\/api\/budgets$/,
  /^\/api\/cards\/moved-in$/,
  /^\/api\/categories$/,
  /^\/api\/categories\/\d+\/detail$/,
  /^\/api\/category-requests$/,
  /^\/api\/data-version$/,
  /^\/api\/excluded-merchants$/,
  /^\/api\/fx-rates$/,
  /^\/api\/home$/,
  /^\/api\/insights$/,
  /^\/api\/integrations$/,
  /^\/api\/settings$/,
  /^\/api\/setup\/status$/,
  /^\/api\/summary(\/trend)?$/,
  /^\/api\/transactions(\/summary)?$/,
  /^\/api\/transactions\/\d+\/history$/,
  /^\/api\/workspaces$/,
  /^\/api\/auth\/sessions$/,
];

const VIEWER_WRITES: [method: string, path: RegExp][] = [
  ["POST", /^\/api\/auth\/logout$/],
  ["DELETE", /^\/api\/auth\/sessions$/],
  ["POST", /^\/api\/auth\/recovery-codes$/],
  ["POST", /^\/api\/auth\/two-factor(\/confirm)?$/],
  ["DELETE", /^\/api\/auth\/two-factor$/],
  ["POST", /^\/api\/auth\/account$/],
  ["POST", /^\/api\/category-requests$/],
  ["DELETE", /^\/api\/category-requests$/],
];

/** API calls that don't read or write workspace data, so need no workspace. */
const WORKSPACE_FREE: RegExp[] = [/^\/api\/auth\//, /^\/api\/workspaces$/, /^\/api\/data-version$/];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

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

function signedOut(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
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

const readOnly = (message = "You have view-only access.") =>
  NextResponse.json({ code: "read_only", message }, { status: 403, headers: { "Cache-Control": "no-store" } });

function viewerGate(request: NextRequest, access: Extract<Access, { role: "viewer" }>): NextResponse {
  const { pathname } = request.nextUrl;
  const method = request.method;

  if (!pathname.startsWith("/api/")) {
    if (VIEWER_PAGES.some((re) => re.test(pathname))) return NextResponse.next();
    // Settings, setup and the rest are the owner's. Their own account page instead.
    return NextResponse.redirect(new URL("/settings/security", request.url));
  }

  const allowed =
    method === "GET" || method === "HEAD"
      ? VIEWER_READS.some((re) => re.test(pathname))
      : VIEWER_WRITES.some(([m, re]) => m === method && re.test(pathname));
  if (!allowed) return readOnly();
  if (WORKSPACE_FREE.some((re) => re.test(pathname))) return NextResponse.next();

  // Only shared workspaces. Without a header the server would pick the first
  // workspace of all, so pin it to theirs.
  const header = request.headers.get("x-workspace-id");
  if (header != null) {
    if (!access.workspaceIds.includes(Number(header))) {
      return NextResponse.json(
        { code: "no_access", message: "That workspace isn't shared with you." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.next();
  }
  const first = access.workspaceIds[0];
  if (first == null) return readOnly("Nothing is shared with you right now.");
  const headers = new Headers(request.headers);
  headers.set("x-workspace-id", String(first));
  return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest) {
  const blocked = crossOriginBlock(request);
  if (blocked) return blocked;
  const { pathname } = request.nextUrl;
  if (isPublic(pathname) || !isAuthEnforced()) return NextResponse.next();

  const access = accessFor(request.cookies.get(SESSION_COOKIE)?.value);
  if (!access) return signedOut(request);
  if (access.role === "viewer") return viewerGate(request, access);
  return NextResponse.next();
}

export const config = {
  // Everything but build assets and public images, which hold nothing private.
  // API paths always run through it, whatever they end with.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|webmanifest)$).*)",
  ],
};
