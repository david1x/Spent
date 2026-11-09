import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { beginEnrollment } from "@/server/auth";
import { authErrorResponse, NO_STORE, readJson, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/**
 * Turning sign-in on, step one: name and password. Returns the authenticator
 * secret and its QR code; nothing is saved until a code from the app is
 * confirmed. Refused once sign-in is on, so it can't replace the account.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const { enrollmentId, secret, uri } = beginEnrollment(str(body.username), str(body.password));
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json(
      { enrollmentId, secret, qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString("base64")}` },
      { headers: NO_STORE }
    );
  } catch (err) {
    return authErrorResponse(err, "enroll");
  }
}
