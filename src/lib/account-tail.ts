/**
 * The short form of an account number: its last four digits, plus the
 * currency when the bank tags a foreign-currency account with one. Leumi,
 * for one, sends "1234/56789-USD" next to the shekel account "800-1234_56",
 * and digits alone made the dollar account look like an unrelated number.
 */
export function accountTail(accountNumber: string | null | undefined): { digits: string; currency: string | null } | null {
  if (!accountNumber) return null;
  const tagged = /^(.*\d.*?)[\s\-_/]([A-Z]{3})$/.exec(accountNumber.trim());
  const base = tagged ? tagged[1] : accountNumber;
  const digits = base.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const currency = tagged && tagged[2] !== "ILS" ? tagged[2] : null;
  return { digits: digits.slice(-4), currency };
}

/** "6789 USD", or "4821" for a shekel account or card. */
export function accountTailText(accountNumber: string | null | undefined): string | null {
  const tail = accountTail(accountNumber);
  if (!tail) return null;
  return tail.currency ? `${tail.digits} ${tail.currency}` : tail.digits;
}
