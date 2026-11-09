import { NextResponse, type NextRequest } from "next/server";
import { regenerateRecoveryCodes } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** New recovery codes (the old ones stop working), confirmed with a current code. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const codes = regenerateRecoveryCodes(str(body.code), clientInfo(request));
    return NextResponse.json({ recoveryCodes: codes }, { headers: NO_STORE });
  } catch (err) {
    return authErrorResponse(err, "recovery codes");
  }
}
