import { NextResponse } from "next/server";
import { getBankCredentialMeta } from "@/server/db/queries/bank-credentials";
import { listLoginCards, setLoginCardSyncEnabled, recordSeenCards } from "@/server/db/queries/login-cards";
import { getWorkspace } from "@/server/db/queries/workspaces";
import { getCardWorkspace, getLoginHome, listRoutedIn, setCardRoute } from "@/server/lib/card-routes";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { CardCheckError, checkLoginCards } from "@/server/sync/orchestrator";
import { getDb } from "@/server/db";
import { BANK_PROVIDERS, type LoginCard } from "@/lib/types";

/**
 * The cards under a card login: which ones sync, and which workspace each
 * one's transactions go to. Managed from the login's own workspace, or from
 * any workspace one of its cards was moved to.
 */

function resolveLogin(request: Request, id: string) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const credentialId = Number(id);
  if (!Number.isInteger(credentialId) || credentialId <= 0) return null;
  const meta =
    getBankCredentialMeta(workspaceId, credentialId) ??
    (listRoutedIn(workspaceId).some((r) => r.credentialId === credentialId) ? getLoginHome(credentialId) : null);
  if (!meta || !BANK_PROVIDERS.find((b) => b.id === meta.provider)?.listsCards) return null;
  return { workspaceId, credentialId };
}

/** Listed cards plus any known only from transactions (synced before the list existed). */
function cardsOf(credentialId: number): LoginCard[] {
  const counts = new Map(
    (
      getDb()
        .prepare(
          "SELECT account_number AS a, COUNT(*) AS n FROM transactions WHERE credential_id = ? GROUP BY account_number"
        )
        .all(credentialId) as { a: string; n: number }[]
    ).map((r) => [r.a, r.n])
  );
  const listed = listLoginCards(credentialId);
  const listedNumbers = new Set(listed.map((c) => c.accountNumber));
  const rows = [
    ...listed.map((c) => ({ ...c, listed: true })),
    ...[...counts.keys()]
      .filter((a) => !listedNumbers.has(a))
      .map((a) => ({ accountNumber: a, label: null, active: true, syncEnabled: true, listed: false })),
  ];
  const names = new Map<number, string>();
  return rows.map((c) => {
    const workspaceId = getCardWorkspace(credentialId, c.accountNumber) ?? 0;
    if (!names.has(workspaceId)) names.set(workspaceId, getWorkspace(workspaceId)?.name ?? "");
    return {
      accountNumber: c.accountNumber,
      label: c.label,
      active: c.active,
      syncEnabled: c.syncEnabled,
      listed: c.listed,
      transactionCount: counts.get(c.accountNumber) ?? 0,
      workspaceId,
      workspaceName: names.get(workspaceId)!,
    };
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const login = resolveLogin(request, (await params).id);
  if (!login) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(cardsOf(login.credentialId));
}

/** The quick card check: sign in and read the card list, no transactions. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const login = resolveLogin(request, (await params).id);
  if (!login) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    await checkLoginCards(login.credentialId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read the card list.";
    return NextResponse.json({ message }, { status: err instanceof CardCheckError ? 409 : 502 });
  }
  return NextResponse.json(cardsOf(login.credentialId));
}

/**
 * Changes one card: whether it syncs, and (before it has transactions) which
 * workspace it goes to. A card that already has transactions moves with the
 * Move action, which moves its rows too.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const login = resolveLogin(request, (await params).id);
  if (!login) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    accountNumber?: unknown;
    syncEnabled?: unknown;
    workspaceId?: unknown;
  } | null;
  const card = cardsOf(login.credentialId).find((c) => c.accountNumber === body?.accountNumber);
  if (!body || !card) return NextResponse.json({ error: "No such card on this login." }, { status: 404 });

  if (typeof body.syncEnabled === "boolean") {
    // A card known only from transactions gets its row now, so the choice sticks.
    if (!card.listed) recordSeenCards(login.credentialId, [{ accountNumber: card.accountNumber }]);
    setLoginCardSyncEnabled(login.credentialId, card.accountNumber, body.syncEnabled);
  }
  if (body.workspaceId !== undefined) {
    if (typeof body.workspaceId !== "number" || !getWorkspace(body.workspaceId)) {
      return NextResponse.json({ error: "Pick a workspace." }, { status: 400 });
    }
    if (card.transactionCount > 0) {
      return NextResponse.json(
        { error: "This card already has transactions. Use Move to take them along." },
        { status: 409 }
      );
    }
    setCardRoute(login.credentialId, card.accountNumber, body.workspaceId);
  }
  return NextResponse.json(cardsOf(login.credentialId));
}
