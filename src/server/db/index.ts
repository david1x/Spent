import "server-only";

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./migrate";
import { refreshEstimatedCharges, seedFxRates } from "../lib/fx-rates";

const DB_DIR = process.env.SPENT_DATA_DIR
  ? path.resolve(process.env.SPENT_DATA_DIR)
  : path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "spent.db");

function createDatabase(): Database.Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  runMigrations(db);
  // Syncs run inside this process, so a run still "running" when the database
  // opens was cut off by a restart or crash. Left as is it would block moving
  // that bank and show as syncing forever.
  db.prepare(
    `UPDATE sync_runs
     SET status = 'failed', completed_at = datetime('now'),
         error_message = 'Interrupted: Spent stopped before this sync finished. Sync again.'
     WHERE status = 'running'`
  ).run();
  // Bundled exchange rates, then shekel estimates for foreign purchases.
  seedFxRates(db);
  refreshEstimatedCharges(db);

  return db;
}

declare global {
  var _db: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis._db) {
    globalThis._db = createDatabase();
  }
  return globalThis._db;
}
