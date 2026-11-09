import { NextResponse } from "next/server";
import { ownerOnly } from "@/server/auth/http";
import { checkClaudeKey, claudeKeyState, maskKey, readClaudeApiKey } from "@/server/ai/api-key";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Whether a Claude key is saved, with a masked hint. `?reveal=1` adds the
 * full key. Owner only: viewers never reach it (proxy) and this checks again.
 */
export async function GET(request: Request) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  const key = readClaudeApiKey();
  const reveal = new URL(request.url).searchParams.get("reveal") === "1";
  return NextResponse.json(
    {
      state: claudeKeyState(),
      hint: key ? maskKey(key) : null,
      ...(reveal && key ? { key } : {}),
    },
    { headers: NO_STORE }
  );
}

/** Tests a key with Anthropic: the one typed in (not saved yet) or the saved one. */
export async function POST(request: Request) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { apiKey?: unknown };
  const typed = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const key = typed || readClaudeApiKey();
  if (!key) return NextResponse.json({ result: "missing" }, { headers: NO_STORE });
  return NextResponse.json({ result: await checkClaudeKey(key) }, { headers: NO_STORE });
}
