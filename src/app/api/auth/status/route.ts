import { NextResponse, type NextRequest } from "next/server";
import { getAuthStatus, isAuthEnforced, validateSession } from "@/server/auth";
import { NO_STORE, sessionToken } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Public: the sign-in page needs it. Details only for whoever may see them. */
export function GET(request: NextRequest) {
  const status = getAuthStatus();
  const signedIn = validateSession(sessionToken(request));
  const mayKnow = signedIn || !isAuthEnforced();
  return NextResponse.json(
    mayKnow
      ? { ...status, signedIn }
      : { enabled: status.enabled, requiredByServer: status.requiredByServer, signedIn: false },
    { headers: NO_STORE }
  );
}
