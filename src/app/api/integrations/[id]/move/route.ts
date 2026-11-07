import { NextResponse } from "next/server";
import { moveCredential, MoveError, previewCredentialMove } from "@/server/lib/move-credential";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fail(error: unknown) {
  if (error instanceof MoveError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

/** What moving this login to `?to=<workspaceId>` would change, for the confirm step. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const credentialId = parseId((await params).id);
  const toWorkspaceId = parseId(new URL(request.url).searchParams.get("to"));
  if (credentialId === null || toWorkspaceId === null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      previewCredentialMove({
        credentialId,
        fromWorkspaceId: getWorkspaceIdFromRequest(request),
        toWorkspaceId,
      })
    );
  } catch (error) {
    return fail(error);
  }
}

/** Moves the login, its transactions and its sync history. Body: { workspaceId }. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const credentialId = parseId((await params).id);
  let body: { workspaceId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const toWorkspaceId = parseId(body.workspaceId);
  if (credentialId === null || toWorkspaceId === null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      moveCredential({
        credentialId,
        fromWorkspaceId: getWorkspaceIdFromRequest(request),
        toWorkspaceId,
      })
    );
  } catch (error) {
    return fail(error);
  }
}
