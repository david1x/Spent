import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { ImportError, importTransactions } from "@/server/sync/import";

/** Rows from a bank's exported file, already mapped to date/description/amount by the client. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { id } = await params;
  const credentialId = Number(id);
  if (!Number.isInteger(credentialId) || credentialId <= 0) {
    return NextResponse.json({ message: "Invalid connection id." }, { status: 400 });
  }

  let body: { rows?: unknown; balance?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ message: "rows must be an array." }, { status: 400 });
  }

  try {
    const result = importTransactions(workspaceId, credentialId, body.rows, body.balance);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    console.error("[import] failed:", err);
    return NextResponse.json({ message: "The import failed. Check the server log for details." }, { status: 500 });
  }
}
