/** The Spent logo and wordmark, for screens outside the app shell (setup, sign-in). */
export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo_lightmode.svg" alt="Spent" className="h-8 w-auto dark:hidden" />
      <img src="/logo_darkmode.svg" alt="Spent" className="hidden h-8 w-auto dark:block" />
      <div>
        <div className="font-serif text-lg font-semibold leading-none tracking-tight">Spent</div>
        <div className="mt-1 text-[8px] font-bold tracking-[0.18em] text-muted-foreground">
          YOUR MONEY · OPEN SOURCE
        </div>
      </div>
    </div>
  );
}
