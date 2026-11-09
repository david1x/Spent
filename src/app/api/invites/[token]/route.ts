import { NextResponse } from "next/server";
import { describeInvite } from "@/server/auth/sharing";
import { NO_STORE } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Public: what an invite link is for, shown before the person signs up. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = describeInvite(token);
  if (!invite) {
    return NextResponse.json(
      { code: "invite_invalid", message: "This invite link has expired or was already used." },
      { status: 410, headers: NO_STORE }
    );
  }
  return NextResponse.json(invite, { headers: NO_STORE });
}
