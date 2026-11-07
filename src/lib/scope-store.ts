/**
 * Which bank bundles the totals cover (see src/server/lib/scope.ts). Empty
 * means every account. Kept per browser and per workspace, since bank login
 * ids belong to one workspace.
 *
 * Starts empty on both server and client and is loaded after mount, so the
 * first render matches the server's.
 */

const KEY_PREFIX = "spent:scope:";

let current: number[] = [];
let workspaceKey = "default";
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getScope(): number[] {
  return current;
}

/** Comma-separated bank login ids for the X-Spent-Scope header, or null for all accounts. */
export function scopeHeaderValue(): string | null {
  return current.length > 0 ? current.join(",") : null;
}

export function setScope(bankIds: number[]): void {
  current = [...new Set(bankIds)].sort((a, b) => a - b);
  try {
    localStorage.setItem(KEY_PREFIX + workspaceKey, JSON.stringify(current));
  } catch {
    // Blocked storage: the scope still applies for this visit.
  }
  emit();
}

/** Loads the saved scope for a workspace. Returns true when it changed. */
export function loadScope(workspaceId: number | null): boolean {
  workspaceKey = workspaceId != null ? String(workspaceId) : "default";
  let saved: number[] = [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + workspaceKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      saved = parsed.filter((n): n is number => Number.isInteger(n) && n > 0);
    }
  } catch {
    saved = [];
  }
  const changed = saved.join(",") !== current.join(",");
  current = saved;
  if (changed) emit();
  return changed;
}

export function subscribeScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
