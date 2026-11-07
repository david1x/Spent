import { redirect } from "next/navigation";
import { getDb } from "@/server/db/index";
import { AppShell } from "@/components/layout/app-shell";
import {
  TransactionsPage,
  type TransactionsInitialFilters,
} from "@/components/transactions/transactions-page";

export const dynamic = "force-dynamic";

function anyWorkspaceHasBank(): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM bank_credentials")
    .get() as { count: number };
  return row.count > 0;
}

const DAY = /^d{4}-d{2}-d{2}$/;

/**
 * Links from elsewhere (Insights) open the list pre-filtered:
 * ?search=…&from=YYYY-MM-DD&to=YYYY-MM-DD&category=12, or ?review=1 for the review queue
 */
export default async function Transactions({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!anyWorkspaceHasBank()) {
    redirect("/setup");
  }
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const from = one(sp.from);
  const to = one(sp.to);
  const category = Number(one(sp.category));
  const initial: TransactionsInitialFilters = {
    search: one(sp.search)?.slice(0, 200),
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    categoryId: Number.isInteger(category) && category > 0 ? category : undefined,
    review: one(sp.review) === "1" || undefined,
  };
  return (
    <AppShell>
      <TransactionsPage key={JSON.stringify(initial)} initial={initial} />
    </AppShell>
  );
}
