/** What to call a transaction on screen: the user's name for it, else the bank's description. */
export function transactionName(txn: { description: string; displayName?: string | null }): string {
  return txn.displayName?.trim() || txn.description;
}

/** True when the user renamed the row, so the bank's own text is worth showing as a subtitle. */
export function isRenamed(txn: { description: string; displayName?: string | null }): boolean {
  return Boolean(txn.displayName?.trim()) && txn.displayName!.trim() !== txn.description;
}
