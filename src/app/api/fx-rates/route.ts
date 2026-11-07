import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getFxStatus, updateFxRates } from "@/server/lib/fx-rates";

/** How current the local exchange rates are. Shared by every workspace. */
export async function GET() {
  return NextResponse.json(getFxStatus(getDb()));
}

/** Fetches newer Bank of Israel rates and refreshes the shekel estimates. */
export async function POST() {
  const db = getDb();
  try {
    const result = await updateFxRates(db);
    return NextResponse.json({ ...result, status: getFxStatus(db) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    console.error("[fx-rates] update failed:", message);
    return NextResponse.json(
      { error: "Couldn't reach the Bank of Israel. Check the connection and try again." },
      { status: 502 }
    );
  }
}
