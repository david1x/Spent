import { cookies } from "next/headers";
import { sessionAccess, SESSION_COOKIE } from "@/server/auth";
import { describeInvite } from "@/server/auth/sharing";
import { InviteScreen } from "@/components/sharing/invite-screen";

export const dynamic = "force-dynamic";

/**
 * Where an invite link lands. The person picks their own sign-in here and is
 * then a viewer of the shared workspaces. Public: they have no session yet.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = describeInvite(token);
  const signedInAs = sessionAccess((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <InviteScreen
      token={token}
      invite={invite}
      signedInAs={signedInAs ? (signedInAs.username ?? "") : null}
    />
  );
}
