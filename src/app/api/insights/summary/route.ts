import { NextResponse } from "next/server";
import { buildInsights } from "@/server/insights";
import { summarizeInsights } from "@/server/insights/summary";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";

/** Asks the connected AI provider (Claude or a local Ollama model) to word the page's findings. */
export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = body?.locale === "he" ? "he" : "en";
  const payload = withRequestScope(request, workspaceId, () => buildInsights(workspaceId));
  if (!payload.ai.provider) {
    return NextResponse.json({ error: "Connect an AI provider in Settings to get a summary." }, { status: 409 });
  }
  try {
    const text = await summarizeInsights(payload, locale);
    return NextResponse.json({ text, provider: payload.ai.provider });
  } catch (err) {
    // Never echo provider errors verbatim: they can include request details.
    console.error("[insights] summary failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The AI provider didn't answer. Try again in a moment." }, { status: 502 });
  }
}
