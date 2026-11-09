import { NextResponse, type NextRequest } from "next/server";
import {
  CategoryRequestError,
  createCategoryRequest,
  listPendingCategoryRequests,
  withdrawCategoryRequest,
} from "@/server/db/queries/category-requests";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { NO_STORE, readJson, requestAccess } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Open category suggestions in this workspace (the owner decides; viewers see theirs waiting). */
export function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json({ requests: listPendingCategoryRequests(workspaceId) }, { headers: NO_STORE });
}

/** A viewer suggests `{ transactionId, categoryId, note? }`. The owner changes it directly instead. */
export async function POST(request: NextRequest) {
  const access = requestAccess(request);
  if (access?.role !== "viewer") {
    return NextResponse.json({ message: "Only people you shared with send suggestions." }, { status: 400 });
  }
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = await readJson(request);
  const transactionId = Number(body.transactionId);
  const categoryId = Number(body.categoryId);
  if (!Number.isInteger(transactionId) || !Number.isInteger(categoryId)) {
    return NextResponse.json({ message: "Send transactionId and categoryId." }, { status: 400 });
  }
  try {
    const created = createCategoryRequest(
      workspaceId,
      { id: access.viewerId, username: access.username },
      transactionId,
      categoryId,
      typeof body.note === "string" ? body.note : null
    );
    return NextResponse.json({ request: created }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof CategoryRequestError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** A viewer takes back `{ id }`, one of their own open suggestions. */
export async function DELETE(request: NextRequest) {
  const access = requestAccess(request);
  if (access?.role !== "viewer") return NextResponse.json({ message: "Not yours to take back." }, { status: 400 });
  const body = await readJson(request);
  const id = Number(body.id);
  const removed =
    Number.isInteger(id) && withdrawCategoryRequest(getWorkspaceIdFromRequest(request), access.viewerId, id);
  return NextResponse.json({ removed }, { status: removed ? 200 : 404, headers: NO_STORE });
}
