import { NextResponse, type NextRequest } from "next/server";
import { accessFor, getAuthStatus, isAuthEnabled, isAuthRequiredByEnv, sessionAccess } from "@/server/auth";
import { NO_STORE, sessionToken } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Public: the sign-in page needs it. Details only for whoever may see them. */
export function GET(request: NextRequest) {
  const token = sessionToken(request);
  const signedIn = sessionAccess(token) != null;
  const access = accessFor(token);
  if (!access) {
    return NextResponse.json(
      { enabled: isAuthEnabled(), requiredByServer: isAuthRequiredByEnv(), signedIn: false },
      { headers: NO_STORE }
    );
  }
  return NextResponse.json({ ...getAuthStatus(access), signedIn }, { headers: NO_STORE });
}
