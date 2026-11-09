import "server-only";

import Anthropic, { APIConnectionError, AuthenticationError, PermissionDeniedError } from "@anthropic-ai/sdk";
import { getSetting } from "../db/queries/settings";
import { decrypt } from "../lib/encryption";

/**
 * The saved Claude API key, decrypted. Null when none is saved, or when it
 * can't be decrypted (the encryption key file changed since it was saved).
 */
export function readClaudeApiKey(): string | null {
  const encrypted = getSetting("ai_api_key_encrypted");
  const iv = getSetting("ai_api_key_iv");
  const authTag = getSetting("ai_api_key_auth_tag");
  if (!encrypted || !iv || !authTag) return null;
  try {
    return decrypt({
      encrypted: Buffer.from(encrypted, "hex"),
      iv: Buffer.from(iv, "hex"),
      authTag: Buffer.from(authTag, "hex"),
    });
  } catch {
    return null;
  }
}

export type ClaudeKeyState = "missing" | "unreadable" | "saved";

export function claudeKeyState(): ClaudeKeyState {
  if (!getSetting("ai_api_key_encrypted")) return "missing";
  return readClaudeApiKey() ? "saved" : "unreadable";
}

/** Enough to recognize the key without showing it: "sk-ant-api03-…AbCd". */
export function maskKey(key: string): string {
  if (key.length <= 16) return "…" + key.slice(-4);
  const dash = key.indexOf("-", 7);
  const head = dash > 0 && dash < 16 ? key.slice(0, dash + 1) : key.slice(0, 7);
  return `${head}…${key.slice(-4)}`;
}

export type KeyCheck = "ok" | "rejected" | "unreachable" | "error";

/** Asks Anthropic whether the key works. Listing models costs nothing. */
export async function checkClaudeKey(key: string): Promise<KeyCheck> {
  try {
    await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10_000 }).models.list({ limit: 1 });
    return "ok";
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return "rejected";
    if (err instanceof APIConnectionError) return "unreachable";
    return "error";
  }
}
