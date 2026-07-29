import historyData from "../data/history-index.json";
import { searchVectorIndex } from "./vector-search";

export type HistoryFilters = {
  dateFrom?: string | null;
  dateTo?: string | null;
  site?: string | null;
  droneId?: string | null;
  merchant?: string | null;
  anomaly?: string | null;
};

export type HistoryEvidence = {
  id: string;
  dataset: string;
  label: string;
  value: string;
  timestamp: string;
};

export type HistoryResultRow = {
  label: string;
  value: number;
};

export type HistoryToolResult = {
  tool: string;
  summary: string;
  rows: HistoryResultRow[];
  evidence: HistoryEvidence[];
  policyRuleIds: string[];
};

type Operation = (typeof historyData.operations)[number];
type Incident = (typeof historyData.incidents)[number];
type Policy = (typeof historyData.policies)[number];

export const HISTORY_TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "query_structured_history",
    description:
      "Calculate counts, averages, or grouped comparisons from structured flight and operational records. Use this for numeric questions, trends, rankings, and comparisons.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: [
            "flight_count",
            "late_delivery_count",
            "operational_exception_count",
            "anomaly_count",
            "average_delivery_minutes",
            "weather_cancellation_count",
            "merchant_delay_count",
            "fleet_grounding_risk_count",
          ],
        },
        group_by: {
          type: "string",
          enum: ["none", "site", "status", "anomaly", "drone", "merchant", "month"],
        },
        filters: {
          type: "object",
          properties: {
            date_from: { type: ["string", "null"] },
            date_to: { type: ["string", "null"] },
            site: { type: ["string", "null"] },
            drone_id: { type: ["string", "null"] },
            merchant: { type: ["string", "null"] },
            anomaly: { type: ["string", "null"] },
          },
          required: [
            "date_from",
            "date_to",
            "site",
            "drone_id",
            "merchant",
            "anomaly",
          ],
          additionalProperties: false,
        },
      },
      required: ["metric", "group_by", "filters"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_incident_reports",
    description:
      "Semantically search incident reports, maintenance events, support resolutions, and operator notes. Use this for causes, similar events, past observations, and qualitative context.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        topic: { type: ["string", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query", "topic", "limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_operating_policy",
    description:
      "Search the supplied operating policy. Use this before explaining a policy threshold, grounding condition, review requirement, or permitted recommendation.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query", "limit"],
      additionalProperties: false,
    },
  },
] as const;

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replaceAll("_", " ");
}

function operationMatches(operation: Operation, filters: HistoryFilters) {
  if (filters.dateFrom && operation.launchAt < filters.dateFrom) return false;
  if (filters.dateTo && operation.launchAt > `${filters.dateTo}T23:59:59`) return false;
  if (filters.site && operation.site !== filters.site) return false;
  if (filters.droneId && operation.droneId !== filters.droneId) return false;
  if (
    filters.merchant &&
    !normalize(operation.merchant).includes(normalize(filters.merchant))
  ) {
    return false;
  }
  if (filters.anomaly && operation.anomaly !== filters.anomaly) return false;
  return true;
}

function metricMatches(operation: Operation, metric: string) {
  switch (metric) {
    case "late_delivery_count":
      return operation.status === "delivered_late";
    case "operational_exception_count":
      return !["delivered", "delivered_late"].includes(operation.status);
    case "anomaly_count":
      return operation.anomaly !== "none";
    case "weather_cancellation_count":
      return operation.status === "cancelled_weather" || operation.anomaly.includes("weather");
    default:
      return true;
  }
}

function groupLabel(operation: Operation, groupBy: string) {
  switch (groupBy) {
    case "site":
      return operation.site.replaceAll("_", " ");
    case "status":
      return operation.status.replaceAll("_", " ");
    case "anomaly":
      return operation.anomaly.replaceAll("_", " ");
    case "drone":
      return operation.droneId;
    case "merchant":
      return operation.merchant;
    case "month":
      return operation.launchAt.slice(0, 7);
    default:
      return "All matching records";
  }
}

function operationEvidence(operation: Operation): HistoryEvidence {
  return {
    id: operation.flightId,
    dataset: "commercial_delivery_operations.csv",
    label: `${operation.flightId} · ${operation.status.replaceAll("_", " ")}`,
    value:
      `${operation.droneId}, ${operation.site.replaceAll("_", " ")}, ` +
      `${operation.anomaly.replaceAll("_", " ")}`,
    timestamp: operation.launchAt,
  };
}

export function queryStructuredHistory(input: {
  metric: string;
  groupBy?: string;
  filters?: HistoryFilters;
}): HistoryToolResult {
  const filters = input.filters ?? {};
  const groupBy = input.groupBy ?? "none";

  if (input.metric === "merchant_delay_count") {
    const delayed = historyData.readiness.filter((row) => {
      if ((row.additionalDelayMinutes ?? 0) <= 0) return false;
      if (filters.dateFrom && row.eventAt < filters.dateFrom) return false;
      if (filters.dateTo && row.eventAt > `${filters.dateTo}T23:59:59`) return false;
      if (
        filters.merchant &&
        !normalize(row.merchant).includes(normalize(filters.merchant))
      ) {
        return false;
      }
      return true;
    });
    const grouped = new Map<string, number>();
    for (const row of delayed) {
      const label = groupBy === "merchant" ? row.merchant : "Delayed readiness events";
      grouped.set(label, (grouped.get(label) ?? 0) + 1);
    }
    const rows = [...grouped.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    return {
      tool: "query_structured_history",
      summary: `${delayed.length.toLocaleString()} readiness events had an additional merchant delay.`,
      rows,
      evidence: delayed.slice(0, 12).map((row) => ({
        id: row.id,
        dataset: "merchant_readiness_events.csv",
        label: `${row.orderId} · ${row.merchant}`,
        value: `${row.additionalDelayMinutes ?? 0} additional minutes`,
        timestamp: row.eventAt,
      })),
      policyRuleIds: ["POL-MERCHANT-READY"],
    };
  }

  if (input.metric === "fleet_grounding_risk_count") {
    const risky = historyData.health.filter(
      (row) =>
        (row.batteryCapacityPct ?? 100) < 80 ||
        (row.cellSpreadMv ?? 0) > 60 ||
        (row.motorVibrationMmS ?? 0) > 3,
    );
    const grouped = new Map<string, number>();
    for (const row of risky) {
      const label =
        groupBy === "site"
          ? row.site.replaceAll("_", " ")
          : groupBy === "drone"
            ? row.droneId
            : "Grounding-threshold snapshots";
      grouped.set(label, (grouped.get(label) ?? 0) + 1);
    }
    const rows = [...grouped.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    return {
      tool: "query_structured_history",
      summary: `${risky.length.toLocaleString()} daily health snapshots crossed a supplied grounding threshold.`,
      rows,
      evidence: risky.slice(0, 12).map((row) => ({
        id: `${row.date}:${row.droneId}`,
        dataset: "drone_health_daily.csv",
        label: `${row.droneId} · ${row.date}`,
        value:
          `${row.batteryCapacityPct}% capacity, ${row.cellSpreadMv} mV spread, ` +
          `${row.motorVibrationMmS} mm/s vibration`,
        timestamp: `${row.date}T00:00:00`,
      })),
      policyRuleIds: ["POL-FLEET-GROUND"],
    };
  }

  const operations = historyData.operations
    .filter((operation) => operationMatches(operation, filters))
    .filter((operation) => metricMatches(operation, input.metric));
  const grouped = new Map<string, { total: number; count: number }>();
  for (const operation of operations) {
    const label = groupLabel(operation, groupBy);
    const current = grouped.get(label) ?? { total: 0, count: 0 };
    current.count += 1;
    current.total +=
      input.metric === "average_delivery_minutes"
        ? operation.actualMinutes ?? 0
        : 1;
    grouped.set(label, current);
  }
  const rows = [...grouped.entries()]
    .map(([label, aggregate]) => ({
      label,
      value:
        input.metric === "average_delivery_minutes"
          ? Number((aggregate.total / Math.max(1, aggregate.count)).toFixed(1))
          : aggregate.total,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const label = input.metric.replaceAll("_", " ");

  return {
    tool: "query_structured_history",
    summary:
      input.metric === "average_delivery_minutes"
        ? `Average delivery time was calculated from ${operations.length.toLocaleString()} matching flights.`
        : `${operations.length.toLocaleString()} matching records for ${label}.`,
    rows,
    evidence: operations.slice(0, 12).map(operationEvidence),
    policyRuleIds: [],
  };
}

export async function searchIncidentReports(input: {
  query: string;
  topic?: string | null;
  limit?: number;
}): Promise<HistoryToolResult> {
  const limit = Math.min(8, Math.max(1, input.limit ?? 5));
  const matches = await searchVectorIndex({
    query: input.query,
    topic: input.topic,
    sourceTypes: ["incident", "maintenance", "support", "operator_note"],
    limit,
  });

  return {
    tool: "search_incident_reports",
    summary: matches.length
      ? `Found ${matches.length} semantically relevant historical narrative records.`
      : "No embedded historical narrative record matched the supplied terms.",
    rows: matches.map((match) => ({
      label: `${match.metadata.sourceId} · ${match.metadata.title}`,
      value: Number((match.score * 100).toFixed(1)),
    })),
    evidence: matches.map((match) => ({
      id: match.metadata.sourceId,
      dataset: match.metadata.dataset,
      label: match.metadata.title,
      value: match.text,
      timestamp: match.metadata.date.includes("T")
        ? match.metadata.date
        : `${match.metadata.date || historyData.summary.dateTo}T00:00:00`,
    })),
    policyRuleIds: [],
  };
}

export async function searchOperatingPolicy(input: {
  query: string;
  limit?: number;
}): Promise<HistoryToolResult> {
  const limit = Math.min(8, Math.max(1, input.limit ?? 5));
  const matches = await searchVectorIndex({
    query: input.query,
    sourceTypes: ["policy"],
    limit,
  });

  return {
    tool: "search_operating_policy",
    summary: matches.length
      ? `Found ${matches.length} relevant supplied-policy rules.`
      : "No supplied-policy rule matched the query.",
    rows: matches.map((match) => ({
      label: match.metadata.sourceId,
      value: Number((match.score * 100).toFixed(1)),
    })),
    evidence: matches.map((match) => ({
      id: match.metadata.sourceId,
      dataset: match.metadata.dataset,
      label: match.metadata.title,
      value: match.text,
      timestamp: historyData.summary.dateTo,
    })),
    policyRuleIds: matches.map((match) => match.metadata.sourceId),
  };
}

export async function executeHistoryTool(
  name: string,
  rawArguments: Record<string, unknown>,
): Promise<HistoryToolResult> {
  if (name === "query_structured_history") {
    const rawFilters =
      rawArguments.filters && typeof rawArguments.filters === "object"
        ? (rawArguments.filters as Record<string, unknown>)
        : {};
    return queryStructuredHistory({
      metric: String(rawArguments.metric ?? "flight_count"),
      groupBy: String(rawArguments.group_by ?? "none"),
      filters: {
        dateFrom: typeof rawFilters.date_from === "string" ? rawFilters.date_from : null,
        dateTo: typeof rawFilters.date_to === "string" ? rawFilters.date_to : null,
        site: typeof rawFilters.site === "string" ? rawFilters.site : null,
        droneId: typeof rawFilters.drone_id === "string" ? rawFilters.drone_id : null,
        merchant: typeof rawFilters.merchant === "string" ? rawFilters.merchant : null,
        anomaly: typeof rawFilters.anomaly === "string" ? rawFilters.anomaly : null,
      },
    });
  }
  if (name === "search_incident_reports") {
    return await searchIncidentReports({
      query: String(rawArguments.query ?? ""),
      topic: typeof rawArguments.topic === "string" ? rawArguments.topic : null,
      limit: Number(rawArguments.limit ?? 5),
    });
  }
  if (name === "search_operating_policy") {
    return await searchOperatingPolicy({
      query: String(rawArguments.query ?? ""),
      limit: Number(rawArguments.limit ?? 5),
    });
  }
  throw new Error(`Unsupported history tool: ${name}`);
}

export function getHistorySummary() {
  return historyData.summary;
}

export function getDatasetCatalog() {
  return historyData.datasets;
}

export function getIncident(id: string): Incident | undefined {
  return historyData.incidents.find((incident) => incident.id === id);
}

export function getPolicy(id: string): Policy | undefined {
  return historyData.policies.find((policy) => policy.id === id);
}
