import { NextResponse } from "next/server";
import {
  getBankCredentials,
  getRequiresManualTwoFactor,
} from "@/server/db/queries/bank-credentials";
import { scrapeBank } from "@/server/scrapers";
import { scrapeOneZeroWithToken } from "@/server/scrapers/one-zero";
import { BANK_PROVIDERS, type BankProvider } from "@/lib/types";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as {
    provider: string;
    credentialId?: number;
    credentials?: Record<string, string>;
  };

  const credentials =
    body.credentials ??
    (body.credentialId != null
      ? getBankCredentials(workspaceId, body.credentialId)
      : null);

  if (!credentials) {
    return NextResponse.json(
      { success: false, message: "No credentials found for this account" },
      { status: 400 }
    );
  }

  const manualTwoFactor =
    body.credentialId != null
      ? getRequiresManualTwoFactor(workspaceId, body.credentialId)
      : false;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // One Zero signs in with a code sent by SMS. Only the sync flow can ask
  // for it, so here we can test a saved long-term token and nothing else.
  const programmaticTwoFactor = Boolean(
    BANK_PROVIDERS.find((b) => b.id === body.provider)?.supportsProgrammaticTwoFactor
  );
  if (programmaticTwoFactor && !credentials.otpLongTermToken) {
    return NextResponse.json({
      success: false,
      message:
        "One Zero signs in with a code it texts to your phone, so it can't be tested here. Save, then press Sync: Spent will send the code and ask you for it.",
    });
  }

  const result = programmaticTwoFactor
    ? await scrapeOneZeroWithToken({
        email: credentials.email,
        password: credentials.password,
        otpLongTermToken: credentials.otpLongTermToken,
        startDate: sevenDaysAgo,
      })
    : await scrapeBank(
        workspaceId,
        body.provider as BankProvider,
        credentials,
        sevenDaysAgo,
        { manualTwoFactor }
      );

  if (!result.success) {
    return NextResponse.json({
      success: false,
      message: result.errorMessage ?? "Connection test failed",
    });
  }

  return NextResponse.json({
    success: true,
    // A test signs in and reads the last week but saves nothing.
    message: `Signed in. Found ${result.accounts.length} ${result.accounts.length === 1 ? "account" : "accounts"}. Press Sync to import transactions.`,
    accountsFound: result.accounts.length,
  });
}
