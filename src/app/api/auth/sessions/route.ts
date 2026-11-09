import { NextResponse, type NextRequest } from "next/server";
import { endOtherSessions, endSessionById, listSessions } from "@/server/auth";
import { NO_STORE, readJson, sessionToken } from "@/server/auth/http";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return NextResponse.json({ sessions: listSessions(sessionToken(request)) }, { headers: NO_STORE });
}

/** `{ id }` signs one browser out; `{ others: true }` every browser but this one. */
export async function DELETE(request: NextRequest) {
  const body = await readJson(request);
  if (body.others === true) {
    return NextResponse.json({ ended: endOtherSessions(sessionToken(request)) });
  }
  if (typeof body.id === "number" && Number.isInteger(body.id)) {
    endSessionById(body.id);
    return NextResponse.json({ ended: 1 });
  }
  return NextResponse.json({ message: "Say which session to end." }, { status: 400 });
}
