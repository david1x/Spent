import { NextResponse } from "next/server";
import {
  createWorkspace,
  listWorkspaces,
} from "@/server/db/queries/workspaces";
import { requestAccess } from "@/server/auth/http";

export async function GET(request: Request) {
  const access = requestAccess(request);
  const all = listWorkspaces();
  // A viewer only learns about the workspaces shared with them.
  return NextResponse.json(
    access?.role === "viewer" ? all.filter((w) => access.workspaceIds.includes(w.id)) : all
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name =
    typeof (body as { name?: unknown })?.name === "string"
      ? ((body as { name: string }).name)
      : "";

  if (!name.trim()) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  try {
    const ws = createWorkspace(name);
    return NextResponse.json(ws, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create workspace" },
      { status: 400 }
    );
  }
}
