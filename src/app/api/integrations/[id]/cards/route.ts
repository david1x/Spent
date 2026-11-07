import { NextResponse } from "next/server";
import { getBankCredentialMeta } from "@/server/db/queries/bank-credentials";
import {
  isBankAccountProvider,
  isCardProvider,
  listCardAccounts,
  reconcileCardBills,
  setCardPaymentLink,
} from "@/server/lib/card-bills";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function parseCredentialId(id: string): number | null {
  const credentialId = Number(id);
  if (!Number.isInteger(credentialId) || credentialId <= 0) return null;
  return credentialId;
}

/** The cards under one card login, with their paying bank links. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const credentialId = parseCredentialId((await params).id);
  if (credentialId === null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const meta = getBankCredentialMeta(workspaceId, credentialId);
  if (!meta) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!isCardProvider(meta.provider)) {
    return NextResponse.json([]);
  }
  return NextResponse.json(listCardAccounts(workspaceId, credentialId));
}

/** Sets or clears which bank login pays one card, then re-matches card bills. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const credentialId = parseCredentialId((await params).id);
  if (credentialId === null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const meta = getBankCredentialMeta(workspaceId, credentialId);
  if (!meta) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!isCardProvider(meta.provider)) {
    return NextResponse.json(
      { error: "Only credit cards can be paid from a bank account." },
      { status: 400 }
    );
  }

  let body: { accountNumber?: unknown; bankCredentialId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { accountNumber, bankCredentialId } = body;
  if (typeof accountNumber !== "string" || accountNumber.length === 0 || accountNumber.length > 64) {
    return NextResponse.json({ error: "accountNumber is required." }, { status: 400 });
  }
  const known = listCardAccounts(workspaceId, credentialId).some(
    (c) => c.accountNumber === accountNumber
  );
  if (!known) {
    return NextResponse.json({ error: "No card with that number under this login." }, { status: 404 });
  }
  if (bankCredentialId !== null) {
    if (typeof bankCredentialId !== "number" || !Number.isInteger(bankCredentialId)) {
      return NextResponse.json(
        { error: "bankCredentialId must be an id or null." },
        { status: 400 }
      );
    }
    const bank = getBankCredentialMeta(workspaceId, bankCredentialId);
    if (!bank || !isBankAccountProvider(bank.provider)) {
      return NextResponse.json({ error: "Choose a connected bank account." }, { status: 400 });
    }
  }

  setCardPaymentLink(workspaceId, credentialId, accountNumber, bankCredentialId);
  reconcileCardBills(workspaceId);
  const card = listCardAccounts(workspaceId, credentialId).find(
    (c) => c.accountNumber === accountNumber
  );
  return NextResponse.json({ success: true, card: card ?? null });
}
