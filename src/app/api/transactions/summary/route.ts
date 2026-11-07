import { NextResponse } from "next/server";
import { getTransactionsSummary } from "@/server/db/queries/transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";

async function handleGET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to are required" },
      { status: 400 }
    );
  }

  const credentialIds = searchParams
    .getAll("credentialIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  // "12" is a whole login, "12:4321" one card under it.
  const accounts = searchParams
    .getAll("accounts")
    .filter((k) => /^d+(:[A-Za-z0-9-]{1,32})?$/.test(k));

  return NextResponse.json(
    getTransactionsSummary(workspaceId, from, to, {
      credentialIds: credentialIds.length > 0 ? credentialIds : undefined,
      accounts: accounts.length > 0 ? accounts : undefined,
    })
  );
}

/** Every total in this route follows the budget scope (bank bundles) the client picked. */
export async function GET(...args: Parameters<typeof handleGET>) {
  const [request] = args;
  return withRequestScope(request, getWorkspaceIdFromRequest(request), () => handleGET(...args));
}
