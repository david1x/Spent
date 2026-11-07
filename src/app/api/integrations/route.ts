import { NextResponse } from "next/server";
import { listBankCredentials } from "@/server/db/queries/bank-credentials";
import { getCredentialStats } from "@/server/db/queries/sync-runs";
import {
  getCardBillMatchCounts,
  getLinkedCardCounts,
  getLoginAccounts,
} from "@/server/lib/card-bills";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const creds = listBankCredentials(workspaceId);
  const matchCounts = getCardBillMatchCounts(workspaceId);
  const accountsByLogin = getLoginAccounts(workspaceId);
  const linkedCards = getLinkedCardCounts(workspaceId);
  const items = creds.map((c) => {
    const stats = getCredentialStats(workspaceId, c.id, c.provider);
    return {
      id: c.id,
      provider: c.provider,
      label: c.label,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastSyncAt: stats.lastSyncAt,
      transactionCount: stats.transactionCount,
      requiresManualTwoFactor: c.requiresManualTwoFactor,
      hasTwoFactorToken: c.hasTwoFactorToken,
      matchedBillCount: matchCounts.get(c.id) ?? 0,
      accounts: accountsByLogin.get(c.id) ?? [],
      linkedCardCount: linkedCards.get(c.id) ?? 0,
    };
  });
  return NextResponse.json(items);
}
