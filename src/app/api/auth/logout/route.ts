import { NextResponse, type NextRequest } from "next/server";
import { endSession } from "@/server/auth";
import { clearSessionCookie, NO_STORE, sessionToken } from "@/server/auth/http";

export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  endSession(sessionToken(request));
  const response = NextResponse.json({ success: true }, { headers: NO_STORE });
  clearSessionCookie(response);
  return response;
}
