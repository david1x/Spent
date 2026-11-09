import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { beginViewerEnrollment } from "@/server/auth";
import { authErrorResponse, NO_STORE, readJson, str } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Joining through an invite, step one: name and password. Same as the owner's, see /api/auth/enroll. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await readJson(request);
    const { enrollmentId, secret, uri } = beginViewerEnrollment(token, str(body.username), str(body.password));
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json(
      { enrollmentId, secret, qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString("base64")}` },
      { headers: NO_STORE }
    );
  } catch (err) {
    return authErrorResponse(err, "invite enroll");
  }
}
