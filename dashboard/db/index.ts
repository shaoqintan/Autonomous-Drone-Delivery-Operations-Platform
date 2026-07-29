import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let schemaReady: Promise<void> | null = null;

export function ensureOperationsTables() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  schemaReady ??= env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS issue_tickets (
        issue_id TEXT PRIMARY KEY NOT NULL,
        scenario_id TEXT NOT NULL,
        status TEXT DEFAULT 'new' NOT NULL,
        owner TEXT DEFAULT 'Unassigned' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        resolved_at TEXT
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS issue_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        issue_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (issue_id) REFERENCES issue_tickets(issue_id) ON UPDATE no action ON DELETE cascade
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS issue_messages_issue_id_idx
      ON issue_messages (issue_id, created_at)
    `),
  ]).then(() => undefined);

  return schemaReady;
}
