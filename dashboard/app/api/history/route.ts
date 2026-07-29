import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  executeHistoryTool,
  getDatasetCatalog,
  getHistorySummary,
  HISTORY_TOOL_DEFINITIONS,
  queryStructuredHistory,
  searchIncidentReports,
  searchOperatingPolicy,
  type HistoryEvidence,
  type HistoryFilters,
  type HistoryResultRow,
  type HistoryToolResult,
} from "../../lib/history-tools";

type ToolTrace = {
  name: string;
  summary: string;
  evidenceCount: number;
};

type HistoryAnswer = {
  status: "ready";
  source: "openai" | "dataset_engine";
  answer: string;
  evidence: HistoryEvidence[];
  rows: HistoryResultRow[];
  toolsUsed: ToolTrace[];
  limitations: string[];
};

type HistoryTurn = {
  question: string;
  answer: string;
};

const HistoryGraphState = Annotation.Root({
  question: Annotation<string>,
  conversationHistory: Annotation<HistoryTurn[]>({
    default: () => [],
    reducer: (_current, update) => update,
  }),
  filters: Annotation<HistoryFilters>({
    default: () => ({}),
    reducer: (_current, update) => update,
  }),
  result: Annotation<HistoryAnswer | null>({
    default: () => null,
    reducer: (_current, update) => update,
  }),
});

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

function filtersForTool(filters: HistoryFilters) {
  return {
    date_from: filters.dateFrom ?? null,
    date_to: filters.dateTo ?? null,
    site: filters.site ?? null,
    drone_id: filters.droneId ?? null,
    merchant: filters.merchant ?? null,
    anomaly: filters.anomaly ?? null,
  };
}

function renderGroundedAnswer(results: HistoryToolResult[]) {
  const useful = results.find((result) => result.rows.length) ?? results[0];
  if (!useful) {
    return "The available datasets do not contain enough matching evidence to answer that question.";
  }
  const leaders = useful.rows
    .slice(0, 4)
    .map((row) => `${row.label}: ${row.value.toLocaleString()}`)
    .join("; ");
  return leaders ? `${useful.summary} ${leaders}.` : useful.summary;
}

async function localHistoryAnswer(
  question: string,
  filters: HistoryFilters,
): Promise<HistoryAnswer> {
  const query = question.toLowerCase();
  const results: HistoryToolResult[] = [];

  if (
    /policy|threshold|ground|safe|launch|wind|visibility|battery|vibration/.test(
      query,
    )
  ) {
    results.push(await searchOperatingPolicy({ query: question, limit: 5 }));
  }

  if (
    /incident|similar|why|cause|happen|report|handover|battery|tether|merchant/.test(
      query,
    )
  ) {
    results.push(await searchIncidentReports({ query: question, limit: 5 }));
  }

  let metric = "";
  let groupBy = "none";
  if (/late|lateness|missed.*promise/.test(query)) {
    metric = "late_delivery_count";
    groupBy = /site|where/.test(query) ? "site" : "merchant";
  } else if (/merchant.*delay|readiness|ready/.test(query)) {
    metric = "merchant_delay_count";
    groupBy = "merchant";
  } else if (/ground|fleet.*risk|health/.test(query)) {
    metric = "fleet_grounding_risk_count";
    groupBy = /drone|aircraft/.test(query) ? "drone" : "site";
  } else if (/weather.*cancel/.test(query)) {
    metric = "weather_cancellation_count";
    groupBy = "site";
  } else if (/exception|cancel|return/.test(query)) {
    metric = "operational_exception_count";
    groupBy = /site/.test(query) ? "site" : "status";
  } else if (/anomal|most common|most frequent|caused/.test(query)) {
    metric = "anomaly_count";
    groupBy = "anomaly";
  } else if (/average|delivery time|how long/.test(query)) {
    metric = "average_delivery_minutes";
    groupBy = /site/.test(query) ? "site" : "month";
  } else if (/how many|count|flight/.test(query)) {
    metric = "flight_count";
    groupBy = /site/.test(query) ? "site" : "month";
  }

  if (metric) {
    results.unshift(
      queryStructuredHistory({
        metric,
        groupBy,
        filters,
      }),
    );
  }

  if (!results.length) {
    results.push(await searchIncidentReports({ query: question, limit: 5 }));
    results.push(await searchOperatingPolicy({ query: question, limit: 5 }));
  }

  const evidence = results
    .flatMap((result) => result.evidence)
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .slice(0, 16);

  return {
    status: "ready",
    source: "dataset_engine",
    answer: renderGroundedAnswer(results),
    evidence,
    rows: results.find((result) => result.rows.length)?.rows ?? [],
    toolsUsed: results.map((result) => ({
      name: result.tool,
      summary: result.summary,
      evidenceCount: result.evidence.length,
    })),
    limitations: [
      process.env.OPENAI_API_KEY
        ? "The model response was unavailable or failed evidence validation; this answer used deterministic dataset retrieval."
        : "OPENAI_API_KEY is not configured; this answer used deterministic dataset retrieval.",
    ],
  };
}

async function answerWithOpenAI(
  question: string,
  filters: HistoryFilters,
  conversationHistory: HistoryTurn[],
): Promise<HistoryAnswer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const tools: unknown[] = [...HISTORY_TOOL_DEFINITIONS];

  const systemText =
    "You answer questions about the supplied historical drone-delivery datasets. " +
    "Choose the tools needed for each question. Use structured history for counts, averages, rankings, and comparisons; " +
    "incident semantic search for narratives and similar events; policy semantic search for operating rules. " +
    "Never calculate statistics from memory. Every factual claim must be supported by returned evidence IDs. " +
    "Previous turns provide conversational context only and are never evidence. " +
    "If the tools do not establish the answer, say that the available datasets cannot establish it. " +
    "Do not authorize or declare a flight safe. Return short claims with exact supporting evidence IDs.";

  const input: unknown[] = [
    {
      role: "developer",
      content: [{ type: "input_text", text: systemText }],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            question,
            filters,
            previousTurns: conversationHistory,
          }),
        },
      ],
    },
  ];
  const toolResults: HistoryToolResult[] = [];

  for (let round = 0; round < 4; round += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 700,
        input,
        tools,
        tool_choice: "auto",
        text: {
          format: {
            type: "json_schema",
            name: "grounded_history_answer",
            strict: true,
            schema: {
              type: "object",
              properties: {
                claims: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string", minLength: 1, maxLength: 600 },
                      evidence_ids: {
                        type: "array",
                        items: { type: "string" },
                        minItems: 1,
                      },
                    },
                    required: ["text", "evidence_ids"],
                    additionalProperties: false,
                  },
                  maxItems: 8,
                },
                insufficient_evidence: { type: "boolean" },
                limitations: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["claims", "insufficient_evidence", "limitations"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      output?: Array<Record<string, unknown>>;
    };
    const calls = (payload.output ?? []).filter(
      (item) => item.type === "function_call",
    );

    if (calls.length) {
      input.push(...(payload.output ?? []));
      for (const call of calls) {
        const name = String(call.name ?? "");
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(call.arguments ?? "{}")) as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        const result = await executeHistoryTool(name, args);
        toolResults.push(result);
        input.push({
          type: "function_call_output",
          call_id: String(call.call_id ?? ""),
          output: JSON.stringify(result),
        });
      }
      continue;
    }

    const outputText = extractOutputText(payload);
    if (!outputText) return null;
    let parsed: {
      claims?: unknown;
      insufficient_evidence?: unknown;
      limitations?: unknown;
    };
    try {
      parsed = JSON.parse(outputText) as typeof parsed;
    } catch {
      return null;
    }

    const availableEvidence = toolResults.flatMap((result) => result.evidence);
    const evidenceById = new Map(
      availableEvidence.map((item) => [item.id, item]),
    );
    const claims = Array.isArray(parsed.claims)
      ? parsed.claims.filter(
          (claim): claim is { text: string; evidence_ids: string[] } =>
            Boolean(
              claim &&
                typeof claim === "object" &&
                typeof (claim as { text?: unknown }).text === "string" &&
                Array.isArray(
                  (claim as { evidence_ids?: unknown }).evidence_ids,
                ),
            ),
        )
      : [];
    const insufficientEvidence = parsed.insufficient_evidence === true;
    if (
      (!insufficientEvidence &&
        (!claims.length ||
          claims.some(
            (claim) =>
              !claim.evidence_ids.length ||
              claim.evidence_ids.some((id) => !evidenceById.has(id)),
          ))) ||
      (insufficientEvidence && claims.length)
    ) {
      return null;
    }
    const evidenceIds = [
      ...new Set(claims.flatMap((claim) => claim.evidence_ids)),
    ];
    const evidence = evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is HistoryEvidence => Boolean(item));
    const answer = insufficientEvidence
      ? "The available datasets do not contain enough matching evidence to answer that question."
      : claims
          .map(
            (claim) =>
              `${claim.text.trim()} [${claim.evidence_ids.join(", ")}]`,
          )
          .join(" ");

    return {
      status: "ready",
      source: "openai",
      answer,
      evidence,
      rows: toolResults.find((result) => result.rows.length)?.rows ?? [],
      toolsUsed: [
        ...toolResults.map((result) => ({
          name: result.tool,
          summary: result.summary,
          evidenceCount: result.evidence.length,
        })),
      ],
      limitations: Array.isArray(parsed.limitations)
        ? parsed.limitations.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  }
  return null;
}

const historyGraph = new StateGraph(HistoryGraphState)
  .addNode("answer_with_tools", async (state) => ({
    result:
      (await answerWithOpenAI(
        state.question,
        state.filters,
        state.conversationHistory,
      )) ??
      (await localHistoryAnswer(state.question, state.filters)),
  }))
  .addEdge(START, "answer_with_tools")
  .addEdge("answer_with_tools", END)
  .compile();

export async function GET() {
  return Response.json({
    summary: getHistorySummary(),
    datasets: getDatasetCatalog(),
    suggestions: [
      "What caused the most operational exceptions?",
      "Which sites had the most late deliveries?",
      "Show incidents involving battery problems.",
      "What policy conditions ground an aircraft?",
    ],
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    semanticSearchConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      question?: unknown;
      filters?: HistoryFilters;
      conversationHistory?: unknown;
      conversation?: unknown;
      messages?: unknown;
    };
    const question =
      typeof payload.question === "string" ? payload.question.trim() : "";
    if (!question || question.length > 1200) {
      return Response.json(
        { error: "A question between 1 and 1200 characters is required." },
        { status: 400 },
      );
    }
    const rawConversation = Array.isArray(payload.conversationHistory)
      ? payload.conversationHistory
      : Array.isArray(payload.conversation)
        ? payload.conversation
        : Array.isArray(payload.messages)
          ? payload.messages
          : [];
    const pairedTurns = rawConversation.some(
      (turn) =>
        Boolean(turn) &&
        typeof turn === "object" &&
        ("question" in (turn as Record<string, unknown>) ||
          "answer" in (turn as Record<string, unknown>)),
    )
      ? rawConversation
      : rawConversation.reduce<Array<{ question: string; answer: string }>>(
          (pairs, turn) => {
            if (!turn || typeof turn !== "object") return pairs;
            const item = turn as Record<string, unknown>;
            const content =
              typeof item.content === "string" ? item.content.trim() : "";
            if (!content) return pairs;
            if (item.role === "assistant" && pairs.length) {
              pairs[pairs.length - 1].answer = content;
            } else if (item.role === "user") {
              pairs.push({ question: content, answer: "" });
            }
            return pairs;
          },
          [],
        );
    const conversationHistory = Array.isArray(pairedTurns)
      ? pairedTurns
          .slice(-8)
          .filter(
            (turn): turn is HistoryTurn =>
              Boolean(turn) &&
              typeof turn === "object" &&
              typeof (turn as HistoryTurn).question === "string" &&
              typeof (turn as HistoryTurn).answer === "string",
          )
          .map((turn) => ({
            question: turn.question.trim().slice(0, 1200),
            answer: turn.answer.trim().slice(0, 2400),
          }))
      : [];
    const state = await historyGraph.invoke({
      question,
      filters: payload.filters ?? {},
      conversationHistory,
    });
    return Response.json(
      state.result ??
        (await localHistoryAnswer(question, payload.filters ?? {})),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Historical analysis failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
