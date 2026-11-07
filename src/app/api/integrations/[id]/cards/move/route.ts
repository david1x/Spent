import { NextResponse } from "next/server";
import { moveCard, MoveError, previewCardMove } from "@/server/lib/move-credential";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseAccount(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null;
}

function fail(error: unknown) {
  if (error instanceof MoveError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

/**
 * What moving one card to `?to=<workspaceId>` would change. The card must
 * currently live in the requesting workspace: its login's, or the one it
 * was moved into.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const url = new URL(request.url);
  const credentialId = parseId((await params).id);
  const accountNumber = parseAccount(url.searchParams.get("account"));
  const toWorkspaceId = parseId(url.searchParams.get("to"));
  if (credentialId === null || accountNumber === null || toWorkspaceId === null) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      previewCardMove({
        credentialId,
        accountNumber,
        fromWorkspaceId: getWorkspaceIdFromRequest(request),
        toWorkspaceId,
      })
    );
  } catch (error) {
    return fail(error);
  }
}

/** Moves one card's transactions and routes its future syncs. Body: { accountNumber, workspaceId }. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const credentialId = parseId((await params).id);
  let body: { accountNumber?: unknown; workspaceId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const accountNumber = parseAccount(body.accountNumber);
  const toWorkspaceId = parseId(body.workspaceId);
  if (credentialId === null || accountNumber === null || toWorkspaceId === null) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      moveCard({
        credentialId,
        accountNumber,
        fromWorkspaceId: getWorkspaceIdFromRequest(request),
        toWorkspaceId,
      })
    );
  } catch (error) {
    return fail(error);
  }
}
