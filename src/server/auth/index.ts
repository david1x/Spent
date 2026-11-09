import "server-only";

import crypto from "crypto";
import { getDb } from "../db/index";
import { deleteGlobalSetting, getGlobalSetting, setGlobalSetting } from "../db/queries/settings";
import { decrypt, encrypt } from "../lib/encryption";
import { generateTotpSecret, matchTotp, otpauthUri } from "./totp";

/**
 * Optional sign-in for Spent, for when it's reachable from outside this
 * computer (a domain, a reverse proxy). Off by default: a local install has
 * nothing to sign in to. One account: a name, a password and an
 * authenticator app (6-digit codes), plus single-use recovery codes.
 *
 * `SPENT_AUTH_REQUIRED=1` makes a fresh install ask for the account before
 * anything else, so a server reachable from the internet is never open, even
 * before setup.
 */

export const SESSION_COOKIE = "spent_session";
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 10;
const RECOVERY_CODE_COUNT = 10;
const PENDING_MINUTES = 10;
const MAX_CODE_TRIES = 5;
const LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LIMIT_PER_IP = 8;
const LIMIT_GLOBAL = 40;

const KEYS = {
  enabled: "auth_enabled",
  enabledAt: "auth_enabled_at",
  username: "auth_username",
  passwordHash: "auth_password_hash",
  totpSecret: "auth_totp_secret",
  totpLastStep: "auth_totp_last_step",
  recoveryCodes: "auth_recovery_codes",
} as const;

export type AuthErrorCode =
  | "invalid_credentials"
  | "invalid_code"
  | "rate_limited"
  | "expired"
  | "already_enabled"
  | "not_enabled"
  | "weak_password"
  | "invalid_username";

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
    public status = 400,
    public retryAfterSeconds?: number
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// State that only lives in memory: half-finished sign-ins and enrollments,
// and failed-attempt counters. Kept on globalThis so dev reloads keep it.

interface PendingLogin {
  expires: number;
  tries: number;
}
interface PendingEnrollment {
  expires: number;
  tries: number;
  username: string;
  passwordHash: string;
  secret: string;
}
interface Counter {
  count: number;
  resetAt: number;
}
interface AuthMemory {
  logins: Map<string, PendingLogin>;
  enrollments: Map<string, PendingEnrollment>;
  failures: Map<string, Counter>;
}

declare global {
  var _spentAuth: AuthMemory | undefined;
}

function memory(): AuthMemory {
  globalThis._spentAuth ??= { logins: new Map(), enrollments: new Map(), failures: new Map() };
  return globalThis._spentAuth;
}

function sweep<T extends { expires: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires < now) map.delete(k);
}

// ---------------------------------------------------------------------------
// Attempt limits. Per address, plus one shared limit so a spoofed
// X-Forwarded-For can't buy unlimited guesses.

function counter(key: string): Counter {
  const now = Date.now();
  const failures = memory().failures;
  let c = failures.get(key);
  if (!c || c.resetAt < now) {
    c = { count: 0, resetAt: now + LIMIT_WINDOW_MS };
    failures.set(key, c);
  }
  return c;
}

function assertNotLimited(ip: string): void {
  for (const [key, limit] of [
    [`ip:${ip}`, LIMIT_PER_IP],
    ["global", LIMIT_GLOBAL],
  ] as const) {
    const c = counter(key);
    if (c.count >= limit) {
      throw new AuthError(
        "rate_limited",
        "Too many attempts. Wait a few minutes and try again.",
        429,
        Math.ceil((c.resetAt - Date.now()) / 1000)
      );
    }
  }
}

function recordFailure(ip: string): void {
  counter(`ip:${ip}`).count++;
  counter("global").count++;
}

function clearFailures(ip: string): void {
  memory().failures.delete(`ip:${ip}`);
}

// ---------------------------------------------------------------------------
// Passwords and codes.

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize("NFKC"), salt, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

function verifyPassword(password: string, stored: string | null): boolean {
  // Without a stored hash, still do the work, so timing doesn't tell names apart.
  const parts = (stored ?? "").split("$");
  const valid = parts.length === 6 && parts[0] === "scrypt";
  const [N, r, p] = valid ? parts.slice(1, 4).map(Number) : [SCRYPT.N, SCRYPT.r, SCRYPT.p];
  const salt = valid ? Buffer.from(parts[4], "base64") : crypto.randomBytes(16);
  const expected = valid ? Buffer.from(parts[5], "base64") : crypto.randomBytes(64);
  const actual = crypto.scryptSync(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT.maxmem,
  });
  return valid && crypto.timingSafeEqual(actual, expected);
}

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

// No 0/o/1/l, which read alike.
const RECOVERY_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = crypto.randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

function storeRecoveryCodes(codes: string[]): void {
  setGlobalSetting(KEYS.recoveryCodes, JSON.stringify(codes.map((c) => sha256(normalizeRecovery(c)))));
}

function recoveryHashes(): string[] {
  try {
    return JSON.parse(getGlobalSetting(KEYS.recoveryCodes) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function storeSecret(secret: string): void {
  const { encrypted, iv, authTag } = encrypt(secret);
  setGlobalSetting(
    KEYS.totpSecret,
    JSON.stringify({ e: encrypted.toString("base64"), i: iv.toString("base64"), t: authTag.toString("base64") })
  );
}

function readSecret(): string | null {
  const raw = getGlobalSetting(KEYS.totpSecret);
  if (!raw) return null;
  const { e, i, t } = JSON.parse(raw) as { e: string; i: string; t: string };
  return decrypt({ encrypted: Buffer.from(e, "base64"), iv: Buffer.from(i, "base64"), authTag: Buffer.from(t, "base64") });
}

/**
 * Checks a 6-digit authenticator code, or else a recovery code (used up on
 * success). A 6-digit code is never also tried as a recovery code.
 */
function checkSecondFactor(code: string): "totp" | "recovery" | null {
  const trimmed = code.trim();
  if (/^\d[\d\s]*$/.test(trimmed)) {
    const secret = readSecret();
    if (!secret) return null;
    const lastStep = Number(getGlobalSetting(KEYS.totpLastStep) ?? -1);
    const step = matchTotp(secret, trimmed, lastStep);
    if (step == null) return null;
    setGlobalSetting(KEYS.totpLastStep, String(step));
    return "totp";
  }
  const hash = sha256(normalizeRecovery(trimmed));
  const hashes = recoveryHashes();
  const index = hashes.findIndex((h) => crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash)));
  if (index < 0) return null;
  hashes.splice(index, 1);
  setGlobalSetting(KEYS.recoveryCodes, JSON.stringify(hashes));
  return "recovery";
}

// ---------------------------------------------------------------------------
// Status.

export function isAuthEnabled(): boolean {
  return getGlobalSetting(KEYS.enabled) === "1";
}

export function isAuthRequiredByEnv(): boolean {
  return process.env.SPENT_AUTH_REQUIRED === "1";
}

/** Whether requests need a session: sign-in is on, or the server demands it. */
export function isAuthEnforced(): boolean {
  return isAuthEnabled() || isAuthRequiredByEnv();
}

export interface AuthStatus {
  enabled: boolean;
  requiredByServer: boolean;
  username: string | null;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

export function getAuthStatus(): AuthStatus {
  const enabled = isAuthEnabled();
  return {
    enabled,
    requiredByServer: isAuthRequiredByEnv(),
    username: enabled ? getGlobalSetting(KEYS.username) : null,
    enabledAt: enabled ? getGlobalSetting(KEYS.enabledAt) : null,
    recoveryCodesLeft: enabled ? recoveryHashes().length : 0,
  };
}

// ---------------------------------------------------------------------------
// Sessions. The cookie holds a random token; the database holds its hash.

export interface ClientInfo {
  ip: string;
  userAgent: string | null;
}

function createSession(client: ClientInfo): string {
  const token = crypto.randomBytes(32).toString("base64url");
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (token_hash, expires_at, user_agent, ip)
       VALUES (?, datetime('now', ?), ?, ?)`
    )
    .run(sha256(token), `+${SESSION_DAYS} days`, client.userAgent?.slice(0, 300) ?? null, client.ip);
  return token;
}

/** True when the token belongs to a live session. Extends it while in use. */
export function validateSession(token: string | undefined | null): boolean {
  if (!token) return false;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, last_seen_at < datetime('now', '-10 minutes') AS stale
       FROM auth_sessions WHERE token_hash = ? AND expires_at > datetime('now')`
    )
    .get(sha256(token)) as { id: number; stale: number } | undefined;
  if (!row) return false;
  // Written at most every 10 minutes, so polling doesn't turn into writes.
  if (row.stale) {
    db.prepare(
      `UPDATE auth_sessions SET last_seen_at = datetime('now'), expires_at = datetime('now', ?) WHERE id = ?`
    ).run(`+${SESSION_DAYS} days`, row.id);
  }
  return true;
}

export function endSession(token: string | undefined | null): void {
  if (!token) return;
  getDb().prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(sha256(token));
}

export interface SessionInfo {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

export function listSessions(currentToken: string | undefined | null): SessionInfo[] {
  const currentHash = currentToken ? sha256(currentToken) : "";
  const rows = getDb()
    .prepare(
      `SELECT id, token_hash, created_at, last_seen_at, user_agent, ip FROM auth_sessions
       WHERE expires_at > datetime('now') ORDER BY last_seen_at DESC`
    )
    .all() as {
    id: number;
    token_hash: string;
    created_at: string;
    last_seen_at: string;
    user_agent: string | null;
    ip: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    userAgent: r.user_agent,
    ip: r.ip,
    current: r.token_hash === currentHash,
  }));
}

export function endSessionById(id: number): void {
  getDb().prepare("DELETE FROM auth_sessions WHERE id = ?").run(id);
}

export function endOtherSessions(currentToken: string | undefined | null): number {
  return getDb()
    .prepare("DELETE FROM auth_sessions WHERE token_hash != ?")
    .run(currentToken ? sha256(currentToken) : "").changes;
}

// ---------------------------------------------------------------------------
// Signing in: password first, then a code, against a short-lived ticket.

export function beginLogin(username: string, password: string, client: ClientInfo): string {
  sweep(memory().logins);
  assertNotLimited(client.ip);
  if (!isAuthEnabled()) throw new AuthError("not_enabled", "Sign-in isn't set up yet.");
  const storedName = getGlobalSetting(KEYS.username) ?? "";
  const nameOk = storedName.toLowerCase() === username.trim().toLowerCase();
  const passwordOk = verifyPassword(password, getGlobalSetting(KEYS.passwordHash));
  if (!nameOk || !passwordOk) {
    recordFailure(client.ip);
    throw new AuthError("invalid_credentials", "That name and password don't match.", 401);
  }
  const ticket = crypto.randomBytes(24).toString("base64url");
  memory().logins.set(ticket, { expires: Date.now() + PENDING_MINUTES * 60_000, tries: 0 });
  return ticket;
}

export function finishLogin(
  ticket: string,
  code: string,
  client: ClientInfo
): { token: string; usedRecoveryCode: boolean; recoveryCodesLeft: number } {
  sweep(memory().logins);
  assertNotLimited(client.ip);
  const pending = memory().logins.get(ticket);
  if (!pending) throw new AuthError("expired", "That took too long. Sign in again.", 401);
  const factor = checkSecondFactor(code);
  if (!factor) {
    recordFailure(client.ip);
    if (++pending.tries >= MAX_CODE_TRIES) memory().logins.delete(ticket);
    throw new AuthError("invalid_code", "That code didn't work. Check the time on your phone, or use a recovery code.", 401);
  }
  memory().logins.delete(ticket);
  clearFailures(client.ip);
  return {
    token: createSession(client),
    usedRecoveryCode: factor === "recovery",
    recoveryCodesLeft: recoveryHashes().length,
  };
}

// ---------------------------------------------------------------------------
// Turning sign-in on: choose a name and password, scan the code, confirm one.

export function validateNewAccount(username: string, password: string): void {
  const name = username.trim();
  if (name.length < 1 || name.length > 64 || /[\u0000-\u001f]/.test(name)) {
    throw new AuthError("invalid_username", "Choose a name of up to 64 characters.");
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 256) {
    throw new AuthError(
      "weak_password",
      `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
}

export function beginEnrollment(
  username: string,
  password: string
): { enrollmentId: string; secret: string; uri: string } {
  sweep(memory().enrollments);
  if (isAuthEnabled()) throw new AuthError("already_enabled", "Sign-in is already on.", 409);
  validateNewAccount(username, password);
  const secret = generateTotpSecret();
  const enrollmentId = crypto.randomBytes(24).toString("base64url");
  memory().enrollments.set(enrollmentId, {
    expires: Date.now() + PENDING_MINUTES * 60_000,
    tries: 0,
    username: username.trim(),
    passwordHash: hashPassword(password),
    secret,
  });
  return { enrollmentId, secret, uri: otpauthUri(secret, username.trim()) };
}

export function finishEnrollment(
  enrollmentId: string,
  code: string,
  client: ClientInfo
): { token: string; recoveryCodes: string[] } {
  sweep(memory().enrollments);
  assertNotLimited(client.ip);
  if (isAuthEnabled()) throw new AuthError("already_enabled", "Sign-in is already on.", 409);
  const pending = memory().enrollments.get(enrollmentId);
  if (!pending) throw new AuthError("expired", "That took too long. Start again.", 400);
  const step = matchTotp(pending.secret, code);
  if (step == null) {
    recordFailure(client.ip);
    if (++pending.tries >= MAX_CODE_TRIES) memory().enrollments.delete(enrollmentId);
    throw new AuthError("invalid_code", "That code didn't match. Check the time on your phone and try the newest code.");
  }
  memory().enrollments.delete(enrollmentId);

  const recoveryCodes = newRecoveryCodes();
  const db = getDb();
  db.transaction(() => {
    setGlobalSetting(KEYS.username, pending.username);
    setGlobalSetting(KEYS.passwordHash, pending.passwordHash);
    storeSecret(pending.secret);
    setGlobalSetting(KEYS.totpLastStep, String(step));
    storeRecoveryCodes(recoveryCodes);
    setGlobalSetting(KEYS.enabledAt, new Date().toISOString());
    db.prepare("DELETE FROM auth_sessions").run();
    setGlobalSetting(KEYS.enabled, "1");
  })();
  return { token: createSession(client), recoveryCodes };
}

// ---------------------------------------------------------------------------
// Managing it, from a signed-in session.

function confirmWithCode(code: string, client: ClientInfo): void {
  assertNotLimited(client.ip);
  if (!checkSecondFactor(code)) {
    recordFailure(client.ip);
    throw new AuthError("invalid_code", "That code didn't work.", 401);
  }
}

export function regenerateRecoveryCodes(code: string, client: ClientInfo): string[] {
  if (!isAuthEnabled()) throw new AuthError("not_enabled", "Sign-in is off.");
  confirmWithCode(code, client);
  const codes = newRecoveryCodes();
  storeRecoveryCodes(codes);
  return codes;
}

export function disableAuth(password: string, code: string, client: ClientInfo): void {
  if (!isAuthEnabled()) throw new AuthError("not_enabled", "Sign-in is off.");
  assertNotLimited(client.ip);
  if (!verifyPassword(password, getGlobalSetting(KEYS.passwordHash))) {
    recordFailure(client.ip);
    throw new AuthError("invalid_credentials", "That password isn't right.", 401);
  }
  confirmWithCode(code, client);
  const db = getDb();
  db.transaction(() => {
    for (const key of Object.values(KEYS)) deleteGlobalSetting(key);
    db.prepare("DELETE FROM auth_sessions").run();
  })();
}
