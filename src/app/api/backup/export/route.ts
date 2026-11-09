import { NextResponse } from "next/server";
import { BackupError, createBackup } from "@/server/lib/backup";

export const dynamic = "force-dynamic";

/** Downloads a password-protected backup of everything (see src/server/lib/backup.ts). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  try {
    const file = await createBackup(body?.password);
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="spent-backup-${day}.spentbackup"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof BackupError) return NextResponse.json({ message: err.message }, { status: 400 });
    console.error("[backup] export failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ message: "The backup couldn't be made." }, { status: 500 });
  }
}
