import { NextResponse } from "next/server";
import {
  queryTransactions,
  type TransactionKindFilter,
} from "@/server/db/queries/transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";

function parseKind(raw: string | null): TransactionKindFilter | undefined {
  if (
    raw === "expense" ||
    raw === "income" ||
    raw === "all" ||
    raw === "spending" ||
    raw === "counted_income" ||
    raw === "not_counted"
  ) {
    return raw;
  }
  return undefined;
}

async function handleGET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);

  // Support multi-id filter ("?categoryIds=1&categoryIds=2") for parent
  // category drilldowns (parent expands to its children client-side).
  const categoryIds = searchParams
    .getAll("categoryIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  const credentialIds = searchParams
    .getAll("credentialIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  // "12" is a whole login, "12:4321" one card under it.
  const accounts = searchParams
    .getAll("accounts")
    .filter((k) => /^d+(:[A-Za-z0-9-]{1,32})?$/.test(k));

  const result = queryTransactions(workspaceId, {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    category: searchParams.has("category")
      ? Number(searchParams.get("category"))
      : undefined,
    categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
    sort: searchParams.get("sort") ?? undefined,
    order: (searchParams.get("order") as "asc" | "desc") ?? undefined,
    limit: searchParams.has("limit")
      ? Number(searchParams.get("limit"))
      : undefined,
    offset: searchParams.has("offset")
      ? Number(searchParams.get("offset"))
      : undefined,
    kind: parseKind(searchParams.get("kind")),
    provider: searchParams.get("provider") ?? undefined,
    credentialIds: credentialIds.length > 0 ? credentialIds : undefined,
    accounts: accounts.length > 0 ? accounts : undefined,
    withAggregates: searchParams.get("aggregates") === "1",
  });

  return NextResponse.json(result);
}

/** Every total in this route follows the budget scope (bank bundles) the client picked. */
export async function GET(...args: Parameters<typeof handleGET>) {
  const [request] = args;
  return withRequestScope(request, getWorkspaceIdFromRequest(request), () => handleGET(...args));
}
