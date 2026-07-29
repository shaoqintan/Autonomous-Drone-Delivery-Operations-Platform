import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const issueTickets = sqliteTable("issue_tickets", {
  issueId: text("issue_id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  status: text("status").notNull().default("new"),
  owner: text("owner").notNull().default("Unassigned"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
});

export const issueMessages = sqliteTable("issue_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id")
    .notNull()
    .references(() => issueTickets.issueId, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  senderName: text("sender_name").notNull(),
  senderRole: text("sender_role").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
