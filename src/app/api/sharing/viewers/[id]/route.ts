import { NextResponse, type NextRequest } from "next/server";
import { endViewerSessions, removeViewer, setViewerWorkspaces } from "@/server/auth/sharing";
import { NO_STORE, ownerOnly, readJson } from "@/server/auth/http";

export const dynamic = "force-dynamic";

function viewerId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** `{ workspaceIds }` changes what they see; `{ signOut: true }` signs them out everywhere. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  const id = viewerId((await params).id);
  if (id == null) return NextResponse.json({ message: "Not found." }, { status: 404 });
  const body = await readJson(request);
  if (body.signOut === true) {
    return NextResponse.json({ ended: endViewerSessions(id) }, { headers: NO_STORE });
  }
  if (!Array.isArray(body.workspaceIds)) {
    return NextResponse.json({ message: "Send workspaceIds." }, { status: 400 });
  }
  const ids = setViewerWorkspaces(id, body.workspaceIds);
  if (ids == null) return NextResponse.json({ message: "Not found." }, { status: 404 });
  return NextResponse.json({ workspaceIds: ids }, { headers: NO_STORE });
}

/** Stops sharing with them: their sign-in is deleted and every browser of theirs signed out. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  const id = viewerId((await params).id);
  if (id == null || !removeViewer(id)) return NextResponse.json({ message: "Not found." }, { status: 404 });
  return NextResponse.json({ removed: true }, { headers: NO_STORE });
}
