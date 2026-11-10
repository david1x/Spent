import { NextResponse, type NextRequest } from "next/server";
import { beginLogin } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, setSessionCookie, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/**
 * Step one: name and password. Returns a ticket for the code step, or, for an
 * account without an authenticator app, signs this browser in.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const result = beginLogin(str(body.username), str(body.password), clientInfo(request));
    if ("ticket" in result) return NextResponse.json({ ticket: result.ticket }, { headers: NO_STORE });
    const response = NextResponse.json({ signedIn: true }, { headers: NO_STORE });
    setSessionCookie(response, request, result.token);
    return response;
  } catch (err) {
    return authErrorResponse(err, "login");
  }
}
