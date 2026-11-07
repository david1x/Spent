import "server-only";

import { getDb } from "../db";

/** Legal suffixes and bank markers that don't tell merchants apart. */
const NOISE_TOKENS = new Set([
  "בעמ", "בע", "הוק", "הו", "בעמ.", "ltd", "inc", "llc", "co", "com", "www", "il", "בעמ)",
]);

/**
 * A comparable merchant key. Card companies spell the same merchant
 * differently: CAL cuts names to 20 characters, banks add the standing-order
 * marker הו"ק, some add בע"מ, and punctuation varies ("ישיר-ביטוח" vs
 * "ישיר ביטוח").
 */
export function normalizeMerchant(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/["'`׳״]/g, "")
    .replace(/[()[\]{}*_.,:;\\/|+-]/g, " ")
    // Long digit runs are references and branch codes; short ones ("019") are names.
    .replace(/\d{4,}/g, " ");
  return s
    .split(/\s+/)
    .filter((tok) => tok !== "" && !NOISE_TOKENS.has(tok))
    .join(" ")
    .trim();
}

/** Shortest key two names must share before a prefix match merges them. */
const MIN_PREFIX = 12;

/**
 * Maps each raw description to a merchant key. Names that are a cut-off
 * version of a longer one share its key, and user merges (merchant_aliases)
 * are applied on top.
 */
export function buildMerchantKeys(workspaceId: number, descriptions: Iterable<string>): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const d of descriptions) if (!normalized.has(d)) normalized.set(d, normalizeMerchant(d));

  // Longest first, so a truncated name finds the full one it was cut from.
  const keys = [...new Set(normalized.values())].sort((a, b) => b.length - a.length);
  const canonical = new Map<string, string>();
  const roots: string[] = [];
  for (const key of keys) {
    const root = key.length >= MIN_PREFIX ? roots.find((r) => r.startsWith(key)) : undefined;
    if (root) canonical.set(key, root);
    else {
      canonical.set(key, key);
      roots.push(key);
    }
  }

  const aliases = getMerchantAliases(workspaceId);
  const resolve = (key: string): string => {
    let k = canonical.get(key) ?? key;
    for (let i = 0; i < 5 && aliases.has(k); i++) k = aliases.get(k)!;
    return k;
  };

  const out = new Map<string, string>();
  for (const [desc, key] of normalized) out.set(desc, resolve(key));
  return out;
}

export function getMerchantAliases(workspaceId: number): Map<string, string> {
  const rows = getDb()
    .prepare("SELECT alias, canonical FROM merchant_aliases WHERE workspace_id = ?")
    .all(workspaceId) as Array<{ alias: string; canonical: string }>;
  return new Map(rows.map((r) => [r.alias, r.canonical]));
}

export function addMerchantAlias(workspaceId: number, alias: string, canonical: string): void {
  if (alias === canonical) return;
  getDb()
    .prepare(
      `INSERT INTO merchant_aliases (workspace_id, alias, canonical) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, alias) DO UPDATE SET canonical = excluded.canonical`
    )
    .run(workspaceId, alias, canonical);
}

/** Words too common in Israeli merchant names to suggest a merge on their own. */
const GENERIC_WORDS = new Set([
  "חברת", "חשבון", "שרותי", "שירותי", "ישראל", "סופר", "מרכז", "תקשורת", "ביטוח", "חיים",
  "בריאות", "טירת", "כרמל", "הכרמל", "תל", "אביב", "ירושלים", "חיפה", "paypal", "google",
  "apple", "amazon", "the", "and", "עיריית", "עירית", "מועצה", "אזורית", "בנק", "לאומי", "הפועלים",
  "דיסקונט", "מזרחי", "העברה", "דיגיטל", "הפקדה", "workspace", "subscription", "membership", "payment",
  "online", "store", "shop", "דמי", "כרטיס", "ישיר",
]);

/** A distinctive word: long enough and not a common one. */
export function distinctiveWords(key: string): string[] {
  return key.split(" ").filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w) && !/^\d+$/.test(w));
}
