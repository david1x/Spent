import { NextResponse } from "next/server";
import fs from "node:fs";
import pkg from "../../../../package.json";
import { DB_PATH } from "@/server/lib/data-dir";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    version: pkg.version,
    hasDb: fs.existsSync(DB_PATH),
  });
}
