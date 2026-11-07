/**
 * "Hide amounts" privacy mode, for using Spent with people around or while
 * sharing a screen. The formatters read this flag and print a mask instead of
 * the number, so every amount in the app follows one switch.
 *
 * Stored per browser in localStorage. It starts as false on both server and
 * client and is applied after mount by `loadAmountsHidden`, which keeps the
 * first render identical to the server's and avoids hydration mismatches.
 */

const STORAGE_KEY = "spent:hide-amounts";

/** Shown in place of the digits. */
export const AMOUNT_MASK = "••••";

let hidden = false;
const listeners = new Set<() => void>();

export function amountsHidden(): boolean {
  return hidden;
}

export function setAmountsHidden(next: boolean): void {
  hidden = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the switch still works for this visit.
  }
  for (const listener of listeners) listener();
}

/** Reads the saved choice. Call once on the client after mount. */
export function loadAmountsHidden(): boolean {
  let saved = false;
  try {
    saved = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    saved = false;
  }
  if (saved !== hidden) {
    hidden = saved;
    for (const listener of listeners) listener();
  }
  return saved;
}

export function subscribeAmountsHidden(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
