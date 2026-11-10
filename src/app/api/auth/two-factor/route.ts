import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { beginTwoFactorSetup, removeTwoFactor } from "@/server/auth";
import { authErrorResponse, clientInfo, NO_STORE, readJson, requestAccess, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

const signedOut = () =>
  NextResponse.json({ code: "signed_out", message: "Sign in to continue." }, { status: 401, headers: NO_STORE });

/** Adding an authenticator app to the signed-in account, step one: the password. */
export async function POST(request: NextRequest) {
  const access = requestAccess(request);
  if (!access) return signedOut();
  try {
    const body = await readJson(request);
    const { setupId, secret, uri } = beginTwoFactorSetup(access, str(body.password), clientInfo(request));
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json(
      { setupId, secret, qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString("base64")}` },
      { headers: NO_STORE }
    );
  } catch (err) {
    return authErrorResponse(err, "two-factor setup");
  }
}

/** Back to the password alone, confirmed with the password and a current code. */
export async function DELETE(request: NextRequest) {
  const access = requestAccess(request);
  if (!access) return signedOut();
  try {
    const body = await readJson(request);
    removeTwoFactor(access, str(body.password), str(body.code), clientInfo(request));
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return authErrorResponse(err, "two-factor remove");
  }
}
