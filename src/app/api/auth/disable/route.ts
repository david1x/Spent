import { NextResponse, type NextRequest } from "next/server";
import { disableAuth } from "@/server/auth";
import { authErrorResponse, clearSessionCookie, clientInfo, NO_STORE, readJson, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Turns sign-in off, confirmed with the password and a current code. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    disableAuth(str(body.password), str(body.code), clientInfo(request));
    const response = NextResponse.json({ success: true }, { headers: NO_STORE });
    clearSessionCookie(response);
    return response;
  } catch (err) {
    return authErrorResponse(err, "disable");
  }
}
