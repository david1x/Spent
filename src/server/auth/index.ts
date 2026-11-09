import "server-only";

import crypto from "crypto";
import { getDb } from "../db/index";
import { deleteGlobalSetting, getGlobalSetting, setGlobalSetting } from "../db/queries/settings";
import { decrypt, encrypt } from "../lib/encryption";
import { generateTotpSecret, matchTotp, otpauthUri } from "./totp";

/**
 * Optional sign-in for Spent, for when it's reachable from outside this
 * computer (a domain, a reverse proxy). Off by default: a local install has
 * nothing to sign in to. The owner's account: a name, a password and an
 * authenticator app (6-digit codes), plus single-use recovery codes. The owner
 * can invite viewers (see ./sharing.ts), who sign in the same way, see only
 * the workspaces shared with them and can't change anything.
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
  | "invalid_username"
  | "name_taken"
  | "invite_invalid"
  | "invalid_request";

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
  account: Account;
}
interface PendingEnrollment {
  expires: number;
  tries: number;
  username: string;
  passwordHash: string;
  secret: string;
  /** Set when a viewer is joining through an invite link. */
  inviteHash?: string;
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

const hashRecoveryCodes = (codes: string[]) => codes.map((c) => sha256(normalizeRecovery(c)));

function sealSecret(secret: string): string {
  const { encrypted, iv, authTag } = encrypt(secret);
  return JSON.stringify({ e: encrypted.toString("base64"), i: iv.toString("base64"), t: authTag.toString("base64") });
}

function openSecret(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const { e, i, t } = JSON.parse(raw) as { e: string; i: string; t: string };
  return decrypt({ encrypted: Buffer.from(e, "base64"), iv: Buffer.from(i, "base64"), authTag: Buffer.from(t, "base64") });
}

function parseHashes(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Accounts: the owner (kept in settings) or a viewer (a row in `viewers`).

export type Account = { kind: "owner" } | { kind: "viewer"; id: number };

const OWNER: Account = { kind: "owner" };

/** Where an account's authenticator secret and recovery codes live. */
interface Factors {
  secret(): string | null;
  lastStep(): number;
  setLastStep(step: number): void;
  recovery(): string[];
  setRecovery(hashes: string[]): void;
}

function factorsFor(account: Account): Factors {
  if (account.kind === "owner") {
    return {
      secret: () => openSecret(getGlobalSetting(KEYS.totpSecret)),
      lastStep: () => Number(getGlobalSetting(KEYS.totpLastStep) ?? -1),
      setLastStep: (step) => setGlobalSetting(KEYS.totpLastStep, String(step)),
      recovery: () => parseHashes(getGlobalSetting(KEYS.recoveryCodes)),
      setRecovery: (hashes) => setGlobalSetting(KEYS.recoveryCodes, JSON.stringify(hashes)),
    };
  }
  const db = getDb();
  const row = () =>
    db.prepare("SELECT totp_secret, totp_last_step, recovery_codes FROM viewers WHERE id = ?").get(account.id) as
      | { totp_secret: string; totp_last_step: number; recovery_codes: string }
      | undefined;
  return {
    secret: () => openSecret(row()?.totp_secret),
    lastStep: () => row()?.totp_last_step ?? -1,
    setLastStep: (step) => {
      db.prepare("UPDATE viewers SET totp_last_step = ? WHERE id = ?").run(step, account.id);
    },
    recovery: () => parseHashes(row()?.recovery_codes),
    setRecovery: (hashes) => {
      db.prepare("UPDATE viewers SET recovery_codes = ? WHERE id = ?").run(JSON.stringify(hashes), account.id);
    },
  };
}

/**
 * Checks a 6-digit authenticator code, or else a recovery code (used up on
 * success). A 6-digit code is never also tried as a recovery code.
 */
function checkSecondFactor(account: Account, code: string): "totp" | "recovery" | null {
  const factors = factorsFor(account);
  const trimmed = code.trim();
  if (/^\d[\d\s]*$/.test(trimmed)) {
    const secret = factors.secret();
    if (!secret) return null;
    const step = matchTotp(secret, trimmed, factors.lastStep());
    if (step == null) return null;
    factors.setLastStep(step);
    return "totp";
  }
  const hash = sha256(normalizeRecovery(trimmed));
  const hashes = factors.recovery();
  const index = hashes.findIndex((h) => crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash)));
  if (index < 0) return null;
  hashes.splice(index, 1);
  factors.setRecovery(hashes);
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

export function ownerName(): string | null {
  return isAuthEnabled() ? getGlobalSetting(KEYS.username) : null;
}

export interface AuthStatus {
  enabled: boolean;
  requiredByServer: boolean;
  role: "owner" | "viewer";
  username: string | null;
  /** The owner's name, for a viewer ("shared by ..."). */
  ownerName: string | null;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

/** What the signed-in account (or, with sign-in off, the owner) may know about itself. */
export function getAuthStatus(access: Access): AuthStatus {
  const enabled = isAuthEnabled();
  return {
    enabled,
    requiredByServer: isAuthRequiredByEnv(),
    role: access.role,
    username: access.role === "viewer" ? access.username : ownerName(),
    ownerName: ownerName(),
    enabledAt: enabled ? getGlobalSetting(KEYS.enabledAt) : null,
    recoveryCodesLeft: enabled ? factorsFor(accountOf(access)).recovery().length : 0,
  };
}

// ---------------------------------------------------------------------------
// Sessions. The cookie holds a random token; the database holds its hash.

export interface ClientInfo {
  ip: string;
  userAgent: string | null;
}

const viewerIdOf = (account: Account): number | null => (account.kind === "viewer" ? account.id : null);

function createSession(client: ClientInfo, account: Account): string {
  const token = crypto.randomBytes(32).toString("base64url");
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (token_hash, expires_at, user_agent, ip, viewer_id)
       VALUES (?, datetime('now', ?), ?, ?, ?)`
    )
    .run(sha256(token), `+${SESSION_DAYS} days`, client.userAgent?.slice(0, 300) ?? null, client.ip, viewerIdOf(account));
  return token;
}

/** Who a request is: the owner, or a viewer and the workspaces they may see. */
export type Access =
  | { role: "owner"; username: string | null }
  | { role: "viewer"; viewerId: number; username: string; workspaceIds: number[] };

/** The live session behind a token, extended while in use; null when there isn't one. */
export function sessionAccess(token: string | undefined | null): Access | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.viewer_id, v.username AS viewer_name,
              s.last_seen_at < datetime('now', '-10 minutes') AS stale
       FROM auth_sessions s LEFT JOIN viewers v ON v.id = s.viewer_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .get(sha256(token)) as { id: number; viewer_id: number | null; viewer_name: string | null; stale: number } | undefined;
  if (!row) return null;
  if (row.viewer_id != null && row.viewer_name == null) return null;
  // Written at most every 10 minutes, so polling doesn't turn into writes.
  if (row.stale) {
    db.prepare(
      `UPDATE auth_sessions SET last_seen_at = datetime('now'), expires_at = datetime('now', ?) WHERE id = ?`
    ).run(`+${SESSION_DAYS} days`, row.id);
  }
  if (row.viewer_id == null) return { role: "owner", username: getGlobalSetting(KEYS.username) };
  const workspaceIds = (
    db
      .prepare("SELECT workspace_id FROM viewer_workspaces WHERE viewer_id = ? ORDER BY workspace_id")
      .all(row.viewer_id) as { workspace_id: number }[]
  ).map((r) => r.workspace_id);
  return { role: "viewer", viewerId: row.viewer_id, username: row.viewer_name ?? "", workspaceIds };
}

/** True when the token belongs to a live session. Extends it while in use. */
export function validateSession(token: string | undefined | null): boolean {
  return sessionAccess(token) != null;
}

/**
 * What a request may do. With sign-in off everyone is the owner; with it on,
 * only a live session counts (null means signed out).
 */
export function accessFor(token: string | undefined | null): Access | null {
  if (!isAuthEnforced()) return { role: "owner", username: null };
  return sessionAccess(token);
}

function accountOf(access: Access): Account {
  return access.role === "viewer" ? { kind: "viewer", id: access.viewerId } : OWNER;
}

function sessionAccount(token: string | undefined | null): Account | null {
  const access = sessionAccess(token);
  return access ? accountOf(access) : null;
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

/** The signed-in account's own sessions (a viewer never sees the owner's). */
export function listSessions(currentToken: string | undefined | null): SessionInfo[] {
  const account = sessionAccount(currentToken);
  if (!account) return [];
  const currentHash = currentToken ? sha256(currentToken) : "";
  const rows = getDb()
    .prepare(
      `SELECT id, token_hash, created_at, last_seen_at, user_agent, ip FROM auth_sessions
       WHERE expires_at > datetime('now') AND viewer_id IS ? ORDER BY last_seen_at DESC`
    )
    .all(viewerIdOf(account)) as {
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

export function endSessionById(id: number, currentToken: string | undefined | null): number {
  const account = sessionAccount(currentToken);
  if (!account) return 0;
  return getDb()
    .prepare("DELETE FROM auth_sessions WHERE id = ? AND viewer_id IS ?")
    .run(id, viewerIdOf(account)).changes;
}

export function endOtherSessions(currentToken: string | undefined | null): number {
  const account = sessionAccount(currentToken);
  if (!account || !currentToken) return 0;
  return getDb()
    .prepare("DELETE FROM auth_sessions WHERE token_hash != ? AND viewer_id IS ?")
    .run(sha256(currentToken), viewerIdOf(account)).changes;
}

// ---------------------------------------------------------------------------
// Signing in: password first, then a code, against a short-lived ticket.

export function beginLogin(username: string, password: string, client: ClientInfo): string {
  sweep(memory().logins);
  assertNotLimited(client.ip);
  if (!isAuthEnabled()) throw new AuthError("not_enabled", "Sign-in isn't set up yet.");
  const name = username.trim();
  const isOwner = (getGlobalSetting(KEYS.username) ?? "").toLowerCase() === name.toLowerCase();
  const viewer = isOwner
    ? undefined
    : (getDb().prepare("SELECT id, password_hash FROM viewers WHERE username = ?").get(name) as
        | { id: number; password_hash: string }
        | undefined);
  const stored = isOwner ? getGlobalSetting(KEYS.passwordHash) : (viewer?.password_hash ?? null);
  const passwordOk = verifyPassword(password, stored);
  if (!passwordOk || (!isOwner && !viewer)) {
    recordFailure(client.ip);
    throw new AuthError("invalid_credentials", "That name and password don't match.", 401);
  }
  const account: Account = viewer ? { kind: "viewer", id: viewer.id } : OWNER;
  const ticket = crypto.randomBytes(24).toString("base64url");
  memory().logins.set(ticket, { expires: Date.now() + PENDING_MINUTES * 60_000, tries: 0, account });
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
  const factor = checkSecondFactor(pending.account, code);
  if (!factor) {
    recordFailure(client.ip);
    if (++pending.tries >= MAX_CODE_TRIES) memory().logins.delete(ticket);
    throw new AuthError("invalid_code", "That code didn't work. Check the time on your phone, or use a recovery code.", 401);
  }
  memory().logins.delete(ticket);
  clearFailures(client.ip);
  return {
    token: createSession(client, pending.account),
    usedRecoveryCode: factor === "recovery",
    recoveryCodesLeft: factorsFor(pending.account).recovery().length,
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

function startEnrollment(
  username: string,
  password: string,
  inviteHash?: string
): { enrollmentId: string; secret: string; uri: string } {
  sweep(memory().enrollments);
  validateNewAccount(username, password);
  const secret = generateTotpSecret();
  const enrollmentId = crypto.randomBytes(24).toString("base64url");
  memory().enrollments.set(enrollmentId, {
    expires: Date.now() + PENDING_MINUTES * 60_000,
    tries: 0,
    username: username.trim(),
    passwordHash: hashPassword(password),
    secret,
    inviteHash,
  });
  return { enrollmentId, secret, uri: otpauthUri(secret, username.trim()) };
}

/** The owner turning sign-in on. */
export function beginEnrollment(
  username: string,
  password: string
): { enrollmentId: string; secret: string; uri: string } {
  if (isAuthEnabled()) throw new AuthError("already_enabled", "Sign-in is already on.", 409);
  return startEnrollment(username, password);
}

/**
 * Takes the pending enrollment if the code matches it (counting a miss).
 * `forInvite` keeps an owner enrollment and an invite enrollment from being
 * finished through each other's endpoint.
 */
function takeEnrollment(
  enrollmentId: string,
  code: string,
  client: ClientInfo,
  forInvite: boolean
): { pending: PendingEnrollment; step: number } {
  sweep(memory().enrollments);
  assertNotLimited(client.ip);
  const pending = memory().enrollments.get(enrollmentId);
  if (!pending || Boolean(pending.inviteHash) !== forInvite) {
    throw new AuthError("expired", "That took too long. Start again.", 400);
  }
  const step = matchTotp(pending.secret, code);
  if (step == null) {
    recordFailure(client.ip);
    if (++pending.tries >= MAX_CODE_TRIES) memory().enrollments.delete(enrollmentId);
    throw new AuthError("invalid_code", "That code didn't match. Check the time on your phone and try the newest code.");
  }
  memory().enrollments.delete(enrollmentId);
  return { pending, step };
}

export function finishEnrollment(
  enrollmentId: string,
  code: string,
  client: ClientInfo
): { token: string; recoveryCodes: string[] } {
  if (isAuthEnabled()) throw new AuthError("already_enabled", "Sign-in is already on.", 409);
  const { pending, step } = takeEnrollment(enrollmentId, code, client, false);

  const recoveryCodes = newRecoveryCodes();
  const db = getDb();
  db.transaction(() => {
    setGlobalSetting(KEYS.username, pending.username);
    setGlobalSetting(KEYS.passwordHash, pending.passwordHash);
    setGlobalSetting(KEYS.totpSecret, sealSecret(pending.secret));
    setGlobalSetting(KEYS.totpLastStep, String(step));
    setGlobalSetting(KEYS.recoveryCodes, JSON.stringify(hashRecoveryCodes(recoveryCodes)));
    setGlobalSetting(KEYS.enabledAt, new Date().toISOString());
    db.prepare("DELETE FROM auth_sessions").run();
    setGlobalSetting(KEYS.enabled, "1");
  })();
  return { token: createSession(client, OWNER), recoveryCodes };
}

// ---------------------------------------------------------------------------
// Joining through an invite link (./sharing.ts makes them).

export const hashInviteToken = (token: string) => sha256(`invite:${token}`);

interface InviteRow {
  id: number;
  workspace_ids: string;
}

const USABLE_INVITE_SQL = `SELECT id, workspace_ids FROM share_invites
  WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`;

/** The unused, unexpired invite behind a link token, or null. */
export function findUsableInvite(token: string): InviteRow | null {
  if (!token || !isAuthEnabled()) return null;
  return (getDb().prepare(USABLE_INVITE_SQL).get(hashInviteToken(token)) as InviteRow | undefined) ?? null;
}

function assertNameFree(username: string): void {
  const name = username.trim();
  const taken =
    (getGlobalSetting(KEYS.username) ?? "").toLowerCase() === name.toLowerCase() ||
    getDb().prepare("SELECT 1 FROM viewers WHERE username = ?").get(name) != null;
  if (taken) throw new AuthError("name_taken", "That name is taken. Choose another.", 409);
}

const INVITE_GONE = () => new AuthError("invite_invalid", "This invite link has expired or was already used.", 410);

export function beginViewerEnrollment(
  inviteToken: string,
  username: string,
  password: string
): { enrollmentId: string; secret: string; uri: string } {
  if (!findUsableInvite(inviteToken)) throw INVITE_GONE();
  validateNewAccount(username, password);
  assertNameFree(username);
  return startEnrollment(username, password, hashInviteToken(inviteToken));
}

export function finishViewerEnrollment(
  enrollmentId: string,
  code: string,
  client: ClientInfo
): { token: string; recoveryCodes: string[] } {
  const { pending, step } = takeEnrollment(enrollmentId, code, client, true);
  const recoveryCodes = newRecoveryCodes();
  const db = getDb();
  const viewerId = db.transaction(() => {
    const invite = db.prepare(USABLE_INVITE_SQL).get(pending.inviteHash) as InviteRow | undefined;
    if (!invite || !isAuthEnabled()) throw INVITE_GONE();
    assertNameFree(pending.username);
    const id = Number(
      db
        .prepare(
          `INSERT INTO viewers (username, password_hash, totp_secret, totp_last_step, recovery_codes)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          pending.username,
          pending.passwordHash,
          sealSecret(pending.secret),
          step,
          JSON.stringify(hashRecoveryCodes(recoveryCodes))
        ).lastInsertRowid
    );
    const share = db.prepare(
      "INSERT OR IGNORE INTO viewer_workspaces (viewer_id, workspace_id) SELECT ?, id FROM workspaces WHERE id = ?"
    );
    for (const workspaceId of parseIds(invite.workspace_ids)) share.run(id, workspaceId);
    db.prepare("UPDATE share_invites SET used_at = datetime('now'), viewer_id = ? WHERE id = ?").run(id, invite.id);
    return id;
  })();
  return { token: createSession(client, { kind: "viewer", id: viewerId }), recoveryCodes };
}

export function parseIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Managing it, from a signed-in session.

function confirmWithCode(account: Account, code: string, client: ClientInfo): void {
  assertNotLimited(client.ip);
  if (!checkSecondFactor(account, code)) {
    recordFailure(client.ip);
    throw new AuthError("invalid_code", "That code didn't work.", 401);
  }
}

export function regenerateRecoveryCodes(access: Access, code: string, client: ClientInfo): string[] {
  if (!isAuthEnabled()) throw new AuthError("not_enabled", "Sign-in is off.");
  const account = accountOf(access);
  confirmWithCode(account, code, client);
  const codes = newRecoveryCodes();
  factorsFor(account).setRecovery(hashRecoveryCodes(codes));
  return codes;
}

export function disableAuth(password: string, code: string, client: ClientInfo): void {
  if (!isAuthEnabled()) throw new AuthError("not_enabled", "Sign-in is off.");
  assertNotLimited(client.ip);
  if (!verifyPassword(password, getGlobalSetting(KEYS.passwordHash))) {
    recordFailure(client.ip);
    throw new AuthError("invalid_credentials", "That password isn't right.", 401);
  }
  confirmWithCode(OWNER, code, client);
  const db = getDb();
  // With sign-in off nobody can be told apart, so sharing ends too.
  db.transaction(() => {
    for (const key of Object.values(KEYS)) deleteGlobalSetting(key);
    db.prepare("DELETE FROM auth_sessions").run();
    db.prepare("DELETE FROM share_invites").run();
    db.prepare("DELETE FROM viewers").run();
  })();
}
