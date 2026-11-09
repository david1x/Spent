import "server-only";

import fs from "fs";
import path from "path";

/**
 * Where Spent keeps its database and encryption key: `SPENT_DATA_DIR` when
 * set (a Docker volume, say), else `data/` in the app folder. Both files must
 * live together: the key decrypts the credentials stored in the database.
 */
export const DATA_DIR = process.env.SPENT_DATA_DIR
  ? path.resolve(process.env.SPENT_DATA_DIR)
  : path.join(process.cwd(), "data");

export const DB_PATH = path.join(DATA_DIR, "spent.db");

const KEY_FILE = ".encryption-key";
const LEGACY_KEY_PATH = path.join(process.cwd(), "data", KEY_FILE);

/**
 * The encryption key file. Older versions always kept the key in `data/`,
 * even with `SPENT_DATA_DIR` set; such a key is copied next to the database
 * the first time, so existing credentials stay readable.
 */
export function keyPath(): string {
  const current = path.join(DATA_DIR, KEY_FILE);
  if (current !== LEGACY_KEY_PATH && !fs.existsSync(current) && fs.existsSync(LEGACY_KEY_PATH)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(LEGACY_KEY_PATH, current);
    fs.chmodSync(current, 0o600);
  }
  return current;
}
