import { NextResponse, type NextRequest } from "next/server";
import { createInvite, revokeInvite } from "@/server/auth/sharing";
import { authErrorResponse, NO_STORE, ownerOnly, readJson } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/**
 * A new invite link for `{ workspaceIds, label }`. The link holds the only
 * copy of its token, so it's returned once, here, and can't be shown again.
 */
export async function POST(request: NextRequest) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const { invite, token } = createInvite(body.workspaceIds, body.label);
    return NextResponse.json({ invite, path: `/invite/${token}` }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return authErrorResponse(err, "create invite");
  }
}

/** `{ id }`: the link stops working. */
export async function DELETE(request: NextRequest) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (typeof body.id !== "number") return NextResponse.json({ message: "Say which invite." }, { status: 400 });
  return NextResponse.json({ revoked: revokeInvite(body.id) }, { headers: NO_STORE });
}
