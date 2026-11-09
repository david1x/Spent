import { NextResponse } from "next/server";
import { isAuthEnabled } from "@/server/auth";
import { INVITE_DAYS, listInvites, listViewers } from "@/server/auth/sharing";
import { NO_STORE, ownerOnly } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Settings, Sharing: who can see what, and the invite links still open. */
export function GET(request: Request) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  const available = isAuthEnabled();
  return NextResponse.json(
    {
      available,
      inviteDays: INVITE_DAYS,
      viewers: available ? listViewers() : [],
      invites: available ? listInvites() : [],
    },
    { headers: NO_STORE }
  );
}
