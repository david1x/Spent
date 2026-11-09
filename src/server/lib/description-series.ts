import "server-only";

/**
 * Some payments carry a running reference in their description, so every
 * month looks like a new payee. A check reads "חיוב צק/12345/0001002/10" one
 * month and "חיוב צק/12345/0001001/10" the month before: same payee code
 * (12345), new check number.
 *
 * Two descriptions are one series when they're identical except for a single
 * long number, and they still share at least one other number. That second
 * rule keeps "transfer to 12345" and "transfer to 67890" apart: there the
 * changing number is the only thing telling the payees apart.
 */

/** Shortest number counted as a reference; short ones ("018", "1/3") are part of the name. */
const MIN_REFERENCE_DIGITS = 4;

/** Alternating text and digit runs: "a/123/b" becomes ["a/", "123", "/b"]. */
function split(description: string): string[] {
  return description.split(/(\d+)/);
}

const isNumber = (part: string) => /^\d+$/.test(part);

export function isSameSeries(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = split(a);
  const pb = split(b);
  if (pa.length !== pb.length) return false;
  let changed = 0;
  let shared = 0;
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] === pb[i]) {
      if (isNumber(pa[i])) shared++;
      continue;
    }
    const reference =
      isNumber(pa[i]) &&
      isNumber(pb[i]) &&
      pa[i].length >= MIN_REFERENCE_DIGITS &&
      pb[i].length >= MIN_REFERENCE_DIGITS;
    if (!reference) return false;
    changed++;
  }
  return changed === 1 && shared >= 1;
}

/** Whether a description could have siblings at all; saves scanning for plain names. */
export function mayHaveSeries(description: string): boolean {
  const numbers = description.match(/\d+/g) ?? [];
  return numbers.length >= 2 && numbers.some((n) => n.length >= MIN_REFERENCE_DIGITS);
}
