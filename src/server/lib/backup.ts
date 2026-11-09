import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import Database from "better-sqlite3";
import { closeDb, getDb } from "../db/index";
import { DATA_DIR, DB_PATH, keyPath } from "./data-dir";
import { readKeyHex, resetKeyCache } from "./encryption";

/**
 * A full backup in one password-protected file: a snapshot of the database
 * (transactions, settings, budgets, saved bank logins) plus the encryption
 * key those logins are stored with. Without the password it can't be read,
 * so it's safe to copy to another machine (or a Docker volume) and restore.
 *
 * Layout: MAGIC, a 4-byte header length, a JSON header (key derivation and
 * cipher parameters), then the AES-256-GCM ciphertext of a gzipped JSON
 * payload { format, createdAt, db (base64), key (hex) }.
 */

const MAGIC = Buffer.from("SPENTBAK1\n", "ascii");
const PAYLOAD_FORMAT = 1;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSWORD_LENGTH = 8;

export class BackupError extends Error {}

interface Header {
  v: 1;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
}

function deriveKey(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  return crypto.scryptSync(password, salt, 32, { ...params, maxmem: SCRYPT.maxmem });
}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new BackupError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

/** A consistent snapshot of the live database, taken with SQLite's online backup. */
async function snapshotDb(): Promise<Buffer> {
  const tmp = path.join(DATA_DIR, `.backup-${crypto.randomBytes(6).toString("hex")}.db`);
  try {
    await getDb().backup(tmp);
    return fs.readFileSync(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export async function createBackup(rawPassword: unknown): Promise<Buffer> {
  const password = checkPassword(rawPassword);
  const payload = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({
        format: PAYLOAD_FORMAT,
        createdAt: new Date().toISOString(),
        db: (await snapshotDb()).toString("base64"),
        key: readKeyHex(),
      })
    )
  );

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(password, salt, SCRYPT), iv);
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  const header: Header = {
    v: 1,
    kdf: "scrypt",
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);
  return Buffer.concat([MAGIC, length, headerBytes, body]);
}

function openBackup(file: Buffer, password: string): { db: Buffer; key: string; createdAt: string } {
  if (file.length < MAGIC.length + 4 || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupError("This isn't a Spent backup file.");
  }
  const headerLength = file.readUInt32BE(MAGIC.length);
  const start = MAGIC.length + 4;
  let header: Header;
  try {
    header = JSON.parse(file.subarray(start, start + headerLength).toString("utf8")) as Header;
  } catch {
    throw new BackupError("This backup file is damaged.");
  }
  if (header.v !== 1 || header.kdf !== "scrypt") {
    throw new BackupError("This backup was made by a newer version of Spent. Update Spent, then restore.");
  }

  let payload: { format: number; createdAt: string; db: string; key: string };
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveKey(password, Buffer.from(header.salt, "base64"), header),
      Buffer.from(header.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(header.tag, "base64"));
    const plain = Buffer.concat([decipher.update(file.subarray(start + headerLength)), decipher.final()]);
    payload = JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
  } catch {
    // GCM can't tell a wrong password from a changed file; both fail here.
    throw new BackupError("Wrong password, or the file was changed after it was made.");
  }
  if (payload.format !== PAYLOAD_FORMAT || !/^[0-9a-f]{64}$/.test(payload.key)) {
    throw new BackupError("This backup file is damaged.");
  }
  return { db: Buffer.from(payload.db, "base64"), key: payload.key, createdAt: payload.createdAt };
}

export interface RestoreResult {
  createdAt: string;
  /** Where the replaced database was saved, in case the restore was a mistake. */
  previousCopy: string | null;
}

/**
 * Replaces this Spent's data with a backup. The current database and key are
 * kept beside them first. The restored database is checked before anything
 * is replaced, and migrations bring an older backup up to date on reopen.
 */
export async function restoreBackup(file: Buffer, rawPassword: unknown): Promise<RestoreResult> {
  const password = checkPassword(rawPassword);
  const backup = openBackup(file, password);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const incoming = path.join(DATA_DIR, `.restore-${crypto.randomBytes(6).toString("hex")}.db`);
  fs.writeFileSync(incoming, backup.db, { mode: 0o600 });
  try {
    const check = new Database(incoming, { readonly: true });
    try {
      const ok = check.pragma("integrity_check", { simple: true }) === "ok";
      const hasData = check
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")
        .get();
      if (!ok || !hasData) throw new BackupError("The database inside this backup is damaged.");
    } finally {
      check.close();
      // Opening it read-only still leaves empty WAL side files behind.
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(incoming + suffix, { force: true });
    }
  } catch (err) {
    fs.rmSync(incoming, { force: true });
    throw err instanceof BackupError ? err : new BackupError("The database inside this backup is damaged.");
  }

  // Keep what's being replaced.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let previousCopy: string | null = null;
  if (fs.existsSync(DB_PATH)) {
    previousCopy = path.join(DATA_DIR, `spent.db.before-restore-${stamp}`);
    await getDb().backup(previousCopy);
  }
  const key = keyPath();
  if (fs.existsSync(key)) fs.copyFileSync(key, `${key}.before-restore-${stamp}`);

  closeDb();
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(DB_PATH + suffix, { force: true });
  fs.renameSync(incoming, DB_PATH);
  fs.writeFileSync(key, backup.key, { mode: 0o600 });
  fs.chmodSync(key, 0o600);
  resetKeyCache();
  getDb();

  return { createdAt: backup.createdAt, previousCopy };
}
