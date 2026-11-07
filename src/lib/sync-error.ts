/**
 * Sync failures are stored as a single `error_message` string. To show a
 * plain-language summary first and keep the technical detail one click away,
 * the summary and detail are joined with a fixed marker.
 */
const DETAIL_MARKER = "\n\nDetails: ";

export function formatSyncError(summary: string, detail: string | null): string {
  const cleanDetail = detail ? stripStackTrace(detail) : "";
  if (!cleanDetail || cleanDetail === summary) return summary;
  return `${summary}${DETAIL_MARKER}${cleanDetail}`;
}

export interface ParsedSyncError {
  summary: string;
  detail: string | null;
}

export function parseSyncError(message: string | null | undefined): ParsedSyncError | null {
  if (!message) return null;
  const markerAt = message.indexOf(DETAIL_MARKER);
  if (markerAt >= 0) {
    return {
      summary: message.slice(0, markerAt),
      detail: message.slice(markerAt + DETAIL_MARKER.length) || null,
    };
  }
  // Older rows used "Friendly sentence. (raw detail)".
  const legacy = message.match(/^([\s\S]*?[.!?])\s+\(([\s\S]+)\)\s*$/);
  if (legacy) {
    return { summary: legacy[1], detail: stripStackTrace(legacy[2]) };
  }
  return { summary: stripStackTrace(message), detail: null };
}

/** Drops "    at foo (C:\path\file.js:1:2)" frames, which leak local paths and help nobody. */
export function stripStackTrace(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*at\s/.test(line))
    .join("\n")
    .trim();
}
