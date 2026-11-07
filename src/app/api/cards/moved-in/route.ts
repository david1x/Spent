import { NextResponse } from "next/server";
import type { RoutedInCard } from "@/lib/types";
import { listCardAccounts } from "@/server/lib/card-bills";
import { getLoginHome, listRoutedIn } from "@/server/lib/card-routes";
import { getWorkspace } from "@/server/db/queries/workspaces";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

/** Cards from other workspaces' logins that were moved into this workspace. */
export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const routes = listRoutedIn(workspaceId);
  const result: RoutedInCard[] = [];

  for (const credentialId of new Set(routes.map((r) => r.credentialId))) {
    const home = getLoginHome(credentialId);
    if (!home) continue;
    const homeName = getWorkspace(home.workspaceId)?.name ?? `Workspace ${home.workspaceId}`;
    const routed = new Set(
      routes.filter((r) => r.credentialId === credentialId).map((r) => r.accountNumber)
    );
    for (const card of listCardAccounts(workspaceId, credentialId)) {
      if (!routed.has(card.accountNumber)) continue;
      result.push({
        credentialId,
        provider: home.provider,
        label: home.label,
        homeWorkspaceId: home.workspaceId,
        homeWorkspaceName: homeName,
        card,
      });
    }
  }

  return NextResponse.json(result);
}
