import { and, asc, eq, inArray } from "drizzle-orm";
import { ensureOperationsTables, getDb } from "../../../db";
import { issueMessages, issueTickets } from "../../../db/schema";

const TICKET_STATUSES = ["new", "in_progress", "waiting", "resolved"] as const;
type TicketStatus = (typeof TICKET_STATUSES)[number];

function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && TICKET_STATUSES.includes(value as TicketStatus);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected issue workflow error";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await ensureOperationsTables();
    const scenarioId = new URL(request.url).searchParams.get("scenarioId")?.trim();
    if (!scenarioId) {
      return Response.json({ error: "scenarioId is required" }, { status: 400 });
    }

    const db = getDb();
    const tickets = await db
      .select()
      .from(issueTickets)
      .where(eq(issueTickets.scenarioId, scenarioId))
      .orderBy(asc(issueTickets.createdAt));
    const messages = tickets.length
      ? await db
          .select()
          .from(issueMessages)
          .where(inArray(issueMessages.issueId, tickets.map((ticket) => ticket.issueId)))
          .orderBy(asc(issueMessages.createdAt), asc(issueMessages.id))
      : [];

    return Response.json({ tickets, messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureOperationsTables();
    const payload = (await request.json()) as
      | { kind?: "sync"; scenarioId?: string; issueIds?: string[] }
      | {
          kind?: "message";
          issueId?: string;
          channel?: string;
          body?: string;
          senderName?: string;
          senderRole?: string;
        };
    const db = getDb();

    if (payload.kind === "sync") {
      const scenarioId = payload.scenarioId?.trim() ?? "";
      const issueIds = Array.isArray(payload.issueIds)
        ? [...new Set(payload.issueIds.filter((id) => typeof id === "string" && id.trim()))]
        : [];
      if (!scenarioId || !issueIds.length) {
        return Response.json(
          { error: "scenarioId and at least one issueId are required" },
          { status: 400 },
        );
      }

      await db
        .insert(issueTickets)
        .values(issueIds.map((issueId) => ({ issueId, scenarioId })))
        .onConflictDoNothing({ target: issueTickets.issueId });
      const tickets = await db
        .select()
        .from(issueTickets)
        .where(
          and(
            eq(issueTickets.scenarioId, scenarioId),
            inArray(issueTickets.issueId, issueIds),
          ),
        );
      return Response.json({ tickets }, { status: 201 });
    }

    if (payload.kind === "message") {
      const issueId = payload.issueId?.trim() ?? "";
      const channel = payload.channel?.trim() ?? "";
      const body = payload.body?.trim() ?? "";
      const senderName = payload.senderName?.trim() || "Operator";
      const senderRole = payload.senderRole?.trim() || "operator";
      if (!issueId || !channel || !body) {
        return Response.json(
          { error: "issueId, channel, and body are required" },
          { status: 400 },
        );
      }

      const [message] = await db
        .insert(issueMessages)
        .values({ issueId, channel, body, senderName, senderRole })
        .returning();
      return Response.json({ message }, { status: 201 });
    }

    return Response.json({ error: "Unsupported issue workflow operation" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureOperationsTables();
    const payload = (await request.json()) as {
      issueId?: string;
      status?: unknown;
      owner?: string;
    };
    const issueId = payload.issueId?.trim() ?? "";
    if (!issueId || !isTicketStatus(payload.status)) {
      return Response.json(
        { error: "issueId and a valid status are required" },
        { status: 400 },
      );
    }

    const updatedAt = new Date().toISOString();
    const [ticket] = await getDb()
      .update(issueTickets)
      .set({
        status: payload.status,
        owner: payload.owner?.trim() || "Unassigned",
        updatedAt,
        resolvedAt: payload.status === "resolved" ? updatedAt : null,
      })
      .where(eq(issueTickets.issueId, issueId))
      .returning();

    if (!ticket) {
      return Response.json({ error: "Issue ticket not found" }, { status: 404 });
    }
    return Response.json({ ticket });
  } catch (error) {
    return errorResponse(error);
  }
}
