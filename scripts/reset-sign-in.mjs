#!/usr/bin/env node
// Turns Spent's sign-in off when you're locked out (lost phone and recovery
// codes). Needs access to the machine or container, which is the point:
// anyone who has that already has the data.
//
//   npm run auth:reset
//   docker exec spent node scripts/reset-sign-in.mjs
//
// Removes the account and every session; transactions and bank logins are
// untouched. Turn sign-in on again in Settings, Security.

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const dataDir = process.env.SPENT_DATA_DIR
  ? path.resolve(process.env.SPENT_DATA_DIR)
  : path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "spent.db");

if (!fs.existsSync(dbPath)) {
  console.error(`No Spent database at ${dbPath}. Set SPENT_DATA_DIR if it lives elsewhere.`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");
const hasSessions = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_sessions'")
  .get();
const result = db.transaction(() => {
  const settings = db.prepare("DELETE FROM settings WHERE key LIKE 'auth\\_%' ESCAPE '\\'").run().changes;
  const sessions = hasSessions ? db.prepare("DELETE FROM auth_sessions").run().changes : 0;
  return { settings, sessions };
})();
db.close();

if (result.settings === 0) {
  console.log("Sign-in was already off.");
} else {
  console.log(`Sign-in is off (${result.sessions} session(s) ended). Turn it on again in Settings, Security.`);
  if (process.env.SPENT_AUTH_REQUIRED === "1") {
    console.log("SPENT_AUTH_REQUIRED is set, so the next visit asks to create a new sign-in.");
  }
}
