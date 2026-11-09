"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Who is looking: the owner (everyone, when sign-in is off) or a viewer the
 * owner shared workspaces with. Decided on the server for each page load; the
 * server enforces it as well, so this only decides what to show.
 */
export interface ClientAccess {
  role: "owner" | "viewer";
  username: string | null;
  /** The owner's name, shown to a viewer ("shared by ..."). */
  ownerName: string | null;
  /** Sign-in is on, so sharing is possible. */
  signInOn: boolean;
}

const AccessContext = createContext<ClientAccess>({
  role: "owner",
  username: null,
  ownerName: null,
  signInOn: false,
});

export function AccessProvider({ value, children }: { value: ClientAccess; children: ReactNode }) {
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): ClientAccess & { readOnly: boolean } {
  const access = useContext(AccessContext);
  return { ...access, readOnly: access.role === "viewer" };
}
