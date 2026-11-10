import { NextResponse, type NextRequest } from "next/server";
import { finishTwoFactorSetup } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, requestAccess, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Adding an authenticator app, step two: a code from it. Returns new recovery codes. */
export async function POST(request: NextRequest) {
  const access = requestAccess(request);
  if (!access) return NextResponse.json({ code: "signed_out", message: "Sign in to continue." }, { status: 401 });
  try {
    const body = await readJson(request);
    const recoveryCodes = finishTwoFactorSetup(access, str(body.setupId), str(body.code), clientInfo(request));
    return NextResponse.json({ recoveryCodes }, { headers: NO_STORE });
  } catch (err) {
    return authErrorResponse(err, "two-factor confirm");
  }
}
