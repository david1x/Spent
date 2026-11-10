export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initScheduler } = await import("@/server/sync/scheduler");
  initScheduler();
  try {
    const { reconcileAfterUpgrade } = await import("@/server/lib/card-bills");
    reconcileAfterUpgrade();
  } catch (err) {
    console.error("[card bills] re-matching after upgrade failed:", err instanceof Error ? err.message : err);
  }
}
