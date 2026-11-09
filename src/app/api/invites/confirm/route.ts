import { NextResponse, type NextRequest } from "next/server";
import { finishViewerEnrollment } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, setSessionCookie, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Joining through an invite, step two: a code from the app. Uses up the invite and signs this browser in. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const { token, recoveryCodes } = finishViewerEnrollment(str(body.enrollmentId), str(body.code), clientInfo(request));
    const response = NextResponse.json({ recoveryCodes }, { headers: NO_STORE });
    setSessionCookie(response, request, token);
    return response;
  } catch (err) {
    return authErrorResponse(err, "invite confirm");
  }
}
