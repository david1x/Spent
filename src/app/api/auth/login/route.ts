import { NextResponse, type NextRequest } from "next/server";
import { beginLogin } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Step one: name and password. Returns a ticket for the code step. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const ticket = beginLogin(str(body.username), str(body.password), clientInfo(request));
    return NextResponse.json({ ticket }, { headers: NO_STORE });
  } catch (err) {
    return authErrorResponse(err, "login");
  }
}
