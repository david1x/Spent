/**
 * Some scrapers (CAL) report currencies as symbols ("$", "₪") instead of ISO
 * codes. Intl.NumberFormat throws on those, so everything goes through here.
 */
const SYMBOLS: Record<string, string> = {
  "₪": "ILS",
  NIS: "ILS",
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

export function normalizeCurrency(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (c === "") return "ILS";
  return SYMBOLS[c] ?? SYMBOLS[c.toUpperCase()] ?? c.toUpperCase();
}
