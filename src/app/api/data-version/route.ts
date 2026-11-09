import { NextResponse } from "next/server";
import { getDb } from "@/server/db/index";

export const dynamic = "force-dynamic";

declare global {
  var _spentBootId: string | undefined;
}

/**
 * Changes whenever anything is written to the database, from any page, tab,
 * sync or background categorizing run. Open pages poll it and refetch their
 * data when it moves, so an edit in one place shows up everywhere.
 *
 * SQLite's total_changes() counts rows written on this connection, and the
 * app shares one connection. It restarts at 0 with the server, so a per-boot
 * id keeps a restart from looking like "no change".
 */
export async function GET() {
  globalThis._spentBootId ??= Math.random().toString(36).slice(2, 10);
  const { changes } = getDb().prepare("SELECT total_changes() AS changes").get() as {
    changes: number;
  };
  return NextResponse.json(
    { version: `${globalThis._spentBootId}:${changes}` },
    { headers: { "Cache-Control": "no-store" } }
  );
}
