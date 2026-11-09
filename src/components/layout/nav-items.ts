import {
  ArrowLeftRight,
  CircleUserRound,
  LayoutDashboard,
  Lightbulb,
  Settings as SettingsIcon,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  /** Key in the `nav` message namespace. */
  labelKey: "home" | "budget" | "insights" | "transactions" | "settings" | "account";
  Icon: LucideIcon;
  match: (pathname: string) => boolean;
  /** Shows the review queue count next to the item. */
  showReviewBadge?: boolean;
}

/**
 * A viewer has no Settings, only their own account (sign-in, recovery codes),
 * which lives at Settings, Security.
 */
export function navItemsFor(readOnly: boolean): NavItem[] {
  if (!readOnly) return NAV_ITEMS;
  return NAV_ITEMS.map((item) =>
    item.labelKey === "settings"
      ? { ...item, href: "/settings/security", labelKey: "account", Icon: CircleUserRound }
      : item
  );
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    labelKey: "home",
    Icon: LayoutDashboard,
    match: (p) => p === "/",
  },
  {
    href: "/budget",
    labelKey: "budget",
    Icon: Wallet,
    match: (p) => p.startsWith("/budget"),
  },
  {
    href: "/insights",
    labelKey: "insights",
    Icon: Lightbulb,
    match: (p) => p.startsWith("/insights"),
  },
  {
    href: "/transactions",
    labelKey: "transactions",
    Icon: ArrowLeftRight,
    match: (p) => p.startsWith("/transactions"),
    showReviewBadge: true,
  },
  {
    href: "/settings",
    labelKey: "settings",
    Icon: SettingsIcon,
    match: (p) => p.startsWith("/settings"),
  },
];
