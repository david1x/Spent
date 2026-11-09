import { NextResponse, type NextRequest } from "next/server";
import { finishLogin } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, setSessionCookie, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Step two: an authenticator or recovery code. Signs this browser in. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const result = finishLogin(str(body.ticket), str(body.code), clientInfo(request));
    const response = NextResponse.json(
      { usedRecoveryCode: result.usedRecoveryCode, recoveryCodesLeft: result.recoveryCodesLeft },
      { headers: NO_STORE }
    );
    setSessionCookie(response, request, result.token);
    return response;
  } catch (err) {
    return authErrorResponse(err, "verify");
  }
}
