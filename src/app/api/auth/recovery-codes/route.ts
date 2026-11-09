import { NextResponse, type NextRequest } from "next/server";
import { regenerateRecoveryCodes } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, requestAccess, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** New recovery codes (the old ones stop working), confirmed with a current code. */
export async function POST(request: NextRequest) {
  const access = requestAccess(request);
  if (!access) return NextResponse.json({ code: "signed_out", message: "Sign in to continue." }, { status: 401 });
  try {
    const body = await readJson(request);
    const codes = regenerateRecoveryCodes(access, str(body.code), clientInfo(request));
    return NextResponse.json({ recoveryCodes: codes }, { headers: NO_STORE });
  } catch (err) {
    return authErrorResponse(err, "recovery codes");
  }
}
