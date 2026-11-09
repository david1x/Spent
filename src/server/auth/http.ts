import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { AuthError, SESSION_COOKIE, SESSION_DAYS, type ClientInfo } from "./index";

/**
 * The visitor's address, for attempt limits and the sessions list. Behind a
 * reverse proxy that's the first X-Forwarded-For entry; anyone can send that
 * header, which is why the limits also have a shared ceiling.
 */
export function clientInfo(request: NextRequest): ClientInfo {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "local";
  return { ip: ip.slice(0, 64), userAgent: request.headers.get("user-agent") };
}

export function sessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value;
}

function isHttps(request: NextRequest): boolean {
  return (
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}

export function setSessionCookie(response: NextResponse, request: NextRequest, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(request),
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export const str = (value: unknown): string => (typeof value === "string" ? value : "");

export function authErrorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof AuthError) {
    const headers: Record<string, string> = {};
    if (err.retryAfterSeconds) headers["Retry-After"] = String(err.retryAfterSeconds);
    return NextResponse.json({ code: err.code, message: err.message }, { status: err.status, headers });
  }
  console.error(`[auth] ${context} failed:`, err instanceof Error ? err.message : err);
  return NextResponse.json({ message: "Something went wrong. Try again." }, { status: 500 });
}

/** Login and status replies must never be cached by a proxy in front of Spent. */
export const NO_STORE = { "Cache-Control": "no-store" };
