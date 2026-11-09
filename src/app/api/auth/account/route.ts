import { NextResponse, type NextRequest } from "next/server";
import { renameAccount } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, requestAccess, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** A new sign-in name for whoever is signed in, confirmed with their password. */
export async function POST(request: NextRequest) {
  const access = requestAccess(request);
  if (!access) return NextResponse.json({ code: "signed_out", message: "Sign in to continue." }, { status: 401 });
  try {
    const body = await readJson(request);
    const username = renameAccount(access, str(body.username), str(body.password), clientInfo(request));
    return NextResponse.json({ username }, { headers: NO_STORE });
  } catch (err) {
    return authErrorResponse(err, "rename");
  }
}
