/** Client calls for the optional sign-in (see src/server/auth). */

export interface AuthStatus {
  enabled: boolean;
  requiredByServer: boolean;
  signedIn: boolean;
  role?: "owner" | "viewer";
  username?: string | null;
  ownerName?: string | null;
  enabledAt?: string | null;
  /** This account also asks for an authenticator code. */
  twoFactor?: boolean;
  recoveryCodesLeft?: number;
}

export interface AuthSession {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

/** An error from the auth API; `code` picks the translated message. */
export class AuthApiError extends Error {
  constructor(
    public code: string | undefined,
    message: string
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    cache: "no-store",
    headers: json !== undefined ? { "Content-Type": "application/json" } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => null)) as ({ code?: string; message?: string } & T) | null;
  if (!res.ok) throw new AuthApiError(body?.code, body?.message ?? "Request failed");
  return body as T;
}

export const getAuthStatus = () => call<AuthStatus>("/api/auth/status");

/** A ticket for the code step, or `signedIn` for an account without an authenticator app. */
export const startLogin = (username: string, password: string) =>
  call<{ ticket?: string; signedIn?: boolean }>("/api/auth/login", { method: "POST", json: { username, password } });

export const finishLogin = (ticket: string, code: string) =>
  call<{ usedRecoveryCode: boolean; recoveryCodesLeft: number }>("/api/auth/verify", {
    method: "POST",
    json: { ticket, code },
  });

export const signOut = () => call<{ success: boolean }>("/api/auth/logout", { method: "POST", json: {} });

/** The authenticator step to show next, or `done` when the account was made without one. */
export type EnrollStart = { enrollmentId: string; secret: string; qr: string } | { done: true };

export const startEnrollment = (username: string, password: string, twoFactor: boolean) =>
  call<EnrollStart>("/api/auth/enroll", {
    method: "POST",
    json: { username, password, twoFactor },
  });

export const finishEnrollment = (enrollmentId: string, code: string) =>
  call<{ recoveryCodes: string[] }>("/api/auth/enroll/confirm", { method: "POST", json: { enrollmentId, code } });

export const listAuthSessions = () => call<{ sessions: AuthSession[] }>("/api/auth/sessions");

export const endAuthSession = (id: number) =>
  call<{ ended: number }>("/api/auth/sessions", { method: "DELETE", json: { id } });

export const endOtherAuthSessions = () =>
  call<{ ended: number }>("/api/auth/sessions", { method: "DELETE", json: { others: true } });

export const newRecoveryCodes = (code: string) =>
  call<{ recoveryCodes: string[] }>("/api/auth/recovery-codes", { method: "POST", json: { code } });

export const startTwoFactor = (password: string) =>
  call<{ setupId: string; secret: string; qr: string }>("/api/auth/two-factor", { method: "POST", json: { password } });

export const confirmTwoFactor = (setupId: string, code: string) =>
  call<{ recoveryCodes: string[] }>("/api/auth/two-factor/confirm", { method: "POST", json: { setupId, code } });

export const removeTwoFactor = (password: string, code: string) =>
  call<{ success: boolean }>("/api/auth/two-factor", { method: "DELETE", json: { password, code } });

export const disableSignIn = (password: string, code: string) =>
  call<{ success: boolean }>("/api/auth/disable", { method: "POST", json: { password, code } });

export interface InviteInfo {
  ownerName: string | null;
  workspaces: string[];
  expiresAt: string;
}

export const getInvite = (token: string) => call<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`);

export const startInviteEnrollment = (token: string, username: string, password: string, twoFactor: boolean) =>
  call<EnrollStart>(`/api/invites/${encodeURIComponent(token)}/enroll`, {
    method: "POST",
    json: { username, password, twoFactor },
  });

export const finishInviteEnrollment = (enrollmentId: string, code: string) =>
  call<{ recoveryCodes: string[] }>("/api/invites/confirm", { method: "POST", json: { enrollmentId, code } });

export const renameAccount = (username: string, password: string) =>
  call<{ username: string }>("/api/auth/account", { method: "POST", json: { username, password } });
