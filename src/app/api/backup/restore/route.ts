import { NextResponse } from "next/server";
import { BackupError, restoreBackup } from "@/server/lib/backup";

export const dynamic = "force-dynamic";

/** Generous: a database with years of transactions is a few tens of MB. */
const MAX_BYTES = 500 * 1024 * 1024;

/** Replaces all data with a backup file (multipart: `file`, `password`). */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ message: "Send the backup file and its password." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "Choose a backup file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ message: "That file is too large to be a Spent backup." }, { status: 400 });
  }
  try {
    const result = await restoreBackup(Buffer.from(await file.arrayBuffer()), form.get("password"));
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof BackupError) return NextResponse.json({ message: err.message }, { status: 400 });
    console.error("[backup] restore failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ message: "The restore failed. Check the server log for details." }, { status: 500 });
  }
}
