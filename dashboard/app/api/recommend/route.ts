import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  executeHistoryTool,
  HISTORY_TOOL_DEFINITIONS,
  type HistoryEvidence,
  type HistoryToolResult,
} from "../../lib/history-tools";
import {
  RESOLUTION_ACTIONS,
  type CoordinationPlan,
  type RecommendationIssue,
  type RecommendationResult,
  type RecommendationToolTrace,
  type ResolutionAction,
} from "../../lib/recommendations";

type ModelSelection = {
  primary_action_id: ResolutionAction;
  evidence_ids: string[];
  policy_rule_ids: string[];
  human_decision_required: true;
};

type ModelRun = {
  selection: ModelSelection;
  toolsUsed: RecommendationToolTrace[];
  additionalEvidence: HistoryEvidence[];
  additionalPolicyRuleIds: string[];
};

const GraphState = Annotation.Root({
  issue: Annotation<RecommendationIssue>,
  selection: Annotation<ModelRun | null>({
    default: () => null,
    reducer: (_current, update) => update,
  }),
  result: Annotation<RecommendationResult | null>({
    default: () => null,
    reducer: (_current, update) => update,
  }),
});

function isResolutionAction(value: unknown): value is ResolutionAction {
  return (
    typeof value === "string" &&
    RESOLUTION_ACTIONS.includes(value as ResolutionAction)
  );
}

function validateIssue(value: unknown): RecommendationIssue {
  if (!value || typeof value !== "object") {
    throw new Error("Issue payload is required");
  }
  const issue = value as Partial<RecommendationIssue>;
  const priorityValues = new Set(["P0", "P1", "P2", "P3"]);
  if (
    typeof issue.id !== "string" ||
    typeof issue.title !== "string" ||
    typeof issue.summary !== "string" ||
    typeof issue.entity !== "string" ||
    typeof issue.category !== "string" ||
    !priorityValues.has(issue.priority ?? "") ||
    issue.humanDecisionRequired !== true ||
    !Array.isArray(issue.ruleIds) ||
    !issue.ruleIds.length ||
    !Array.isArray(issue.evidence) ||
    !issue.evidence.length ||
    !Array.isArray(issue.allowedActions) ||
    !issue.allowedActions.length ||
    !issue.allowedActions.every(isResolutionAction) ||
    !isResolutionAction(issue.defaultAction) ||
    !issue.allowedActions.includes(issue.defaultAction)
  ) {
    throw new Error("Issue payload failed the deterministic contract");
  }
  if (
    !issue.evidence.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.dataset === "string" &&
        typeof item.label === "string" &&
        typeof item.value === "string" &&
        typeof item.timestamp === "string",
    )
  ) {
    throw new Error("Evidence payload failed the deterministic contract");
  }
  return issue as RecommendationIssue;
}

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

function buildCoordinationPlan(
  issue: RecommendationIssue,
  action: ResolutionAction,
): CoordinationPlan {
  let contactName = "Operations control";
  let contactRole = "Duty operator";
  let channel = "Ops control";
  let instruction = "Confirm owner and ETA.";

  if (
    action.includes("MAINTENANCE") ||
    action === "GROUND_AIRCRAFT" ||
    action === "AWAIT_VALIDATED_MAINTENANCE_RELEASE"
  ) {
    contactName = "Maintenance team";
    contactRole = "Aircraft maintenance";
    channel = "Maintenance";
    instruction = `Inspect ${issue.entity}. Share findings and ETA.`;
  } else if (
    action === "REESTIMATE_PROMISE_FROM_ACTUAL_READY" ||
    action === "REQUIRE_HANDOFF_VERIFICATION"
  ) {
    contactName = "Merchant partner";
    contactRole = "Merchant operations";
    channel = "Merchant";
    instruction = `Confirm ready time and blockers for ${issue.entity}.`;
  } else if (
    action === "CUSTOMER_OUTREACH" ||
    action === "MARK_DELIVERY_EXCEPTION"
  ) {
    contactName = "Customer support";
    contactRole = "Delivery support";
    channel = "Customer support";
    instruction = "Update the customer and post the response.";
  } else if (
    action === "HOLD_LAUNCH" ||
    action === "DEFER_ORDER" ||
    action === "REASSIGN_ORDER" ||
    action === "REMOVE_INVALID_ASSIGNMENT"
  ) {
    contactName = "Site dispatch";
    contactRole = "Flight planning";
    channel = "Dispatch";
    instruction = "Confirm the hold and revised plan.";
  }

  const required = action !== "NO_RECOMMENDATION_INSUFFICIENT_EVIDENCE";
  const fallbackDraft = `${issue.title}: ${issue.summary} ${instruction}`;

  return {
    required,
    channel,
    contactName,
    contactRole,
    subject: `${issue.priority} action needed · ${issue.entity}`,
    draftMessage: fallbackDraft,
  };
}

function renderDecisionSummary(
  action: ResolutionAction,
  _evidenceIds: string[],
  _policyRuleIds: string[],
) {
  if (action === "NO_RECOMMENDATION_INSUFFICIENT_EVIDENCE") {
    return "The available evidence is insufficient. A human operator must investigate before taking action.";
  }
  return "Review this recommendation against the cited policy and evidence before applying it.";
}

async function chooseWithOpenAI(
  issue: RecommendationIssue,
): Promise<ModelRun | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const tools: unknown[] = [...HISTORY_TOOL_DEFINITIONS];
  const input: unknown[] = [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text:
            "You are a constrained operations recommendation agent. Policy priority and the allowed action list are final. " +
            "Decide whether the supplied issue evidence is sufficient or whether to use historical structured queries, incident search, " +
            "or operating-policy search before choosing exactly one allowed action. " +
            "Use structured history for numeric patterns, incident search for comparable events, and policy search for authoritative rules. " +
            "Never invent facts or use an evidence or policy ID that was not supplied or returned by a tool. " +
            "If the available evidence does not support a resolution, select NO_RECOMMENDATION_INSUFFICIENT_EVIDENCE when it is allowed. " +
            "Never authorize, clear, release, or declare a flight safe. Every result requires a human decision. " +
            "Return only the selected action and the exact supporting IDs; the server writes the operator-facing explanation.",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            issue_id: issue.id,
            priority: issue.priority,
            category: issue.category,
            title: issue.title,
            summary: issue.summary,
            entity: issue.entity,
            launch_blocking: issue.launchBlocking,
            allowed_action_ids: issue.allowedActions,
            triggered_policy_rule_ids: issue.ruleIds,
            supplied_evidence: issue.evidence,
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
        max_output_tokens: 520,
        input,
        tools,
        tool_choice: "auto",
        text: {
          format: {
            type: "json_schema",
            name: "validated_resolution_selection",
            strict: true,
            schema: {
              type: "object",
              properties: {
                primary_action_id: {
                  type: "string",
                  enum: issue.allowedActions,
                },
                evidence_ids: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                },
                policy_rule_ids: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                },
                human_decision_required: {
                  type: "boolean",
                  const: true,
                },
              },
              required: [
                "primary_action_id",
                "evidence_ids",
                "policy_rule_ids",
                "human_decision_required",
              ],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const raw = (await response.json()) as {
      output?: Array<Record<string, unknown>>;
    };
    const calls = (raw.output ?? []).filter(
      (item) => item.type === "function_call",
    );
    if (calls.length) {
      input.push(...(raw.output ?? []));
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(call.arguments ?? "{}")) as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        const result = await executeHistoryTool(String(call.name ?? ""), args);
        toolResults.push(result);
        input.push({
          type: "function_call_output",
          call_id: String(call.call_id ?? ""),
          output: JSON.stringify(result),
        });
      }
      continue;
    }

    const text = extractOutputText(raw);
    if (!text) return null;
    let selection: ModelSelection;
    try {
      selection = JSON.parse(text) as ModelSelection;
    } catch {
      return null;
    }
    const additionalEvidence = [
      ...toolResults.flatMap((result) => result.evidence),
    ];
    const allowedActions = new Set(issue.allowedActions);
    const allowedEvidence = new Set([
      ...issue.evidence.map((item) => item.id),
      ...additionalEvidence.map((item) => item.id),
    ]);
    const additionalPolicyRuleIds = toolResults.flatMap(
      (result) => result.policyRuleIds,
    );
    const allowedRules = new Set([
      ...issue.ruleIds,
      ...additionalPolicyRuleIds,
    ]);
    if (
      !allowedActions.has(selection.primary_action_id) ||
      selection.human_decision_required !== true ||
      !Array.isArray(selection.evidence_ids) ||
      !selection.evidence_ids.length ||
      !selection.evidence_ids.every((id) => allowedEvidence.has(id)) ||
      !Array.isArray(selection.policy_rule_ids) ||
      !selection.policy_rule_ids.length ||
      !selection.policy_rule_ids.every((id) => allowedRules.has(id))
    ) {
      return null;
    }
    return {
      selection,
      additionalEvidence,
      additionalPolicyRuleIds,
      toolsUsed: [
        ...toolResults.map((result) => ({
          name: result.tool,
          summary: result.summary,
          evidenceCount: result.evidence.length,
        })),
      ],
    };
  }
  return null;
}

const recommendationGraph = new StateGraph(GraphState)
  .addNode("validate_input", async (state) => ({
    issue: validateIssue(state.issue),
  }))
  .addNode("select_approved_action", async (state) => ({
    selection: await chooseWithOpenAI(state.issue),
  }))
  .addNode("validate_and_render", async (state) => {
    if (!state.selection) {
      const actionId = state.issue.defaultAction;
      return {
        result: {
          status: "ready" as const,
          actionId,
          source: "policy_engine" as const,
          evidenceIds: state.issue.evidence.map((item) => item.id),
          evidence: state.issue.evidence,
          policyRuleIds: state.issue.ruleIds,
          decisionSummary: renderDecisionSummary(
            actionId,
            state.issue.evidence.map((item) => item.id),
            state.issue.ruleIds,
          ),
          toolsUsed: [],
          humanDecisionRequired: true as const,
          coordination: buildCoordinationPlan(state.issue, actionId),
        },
      };
    }
    const availableEvidence = [
      ...state.issue.evidence,
      ...state.selection.additionalEvidence,
    ];
    return {
      result: {
        status: "ready" as const,
        actionId: state.selection.selection.primary_action_id,
        source: "openai" as const,
        evidenceIds: state.selection.selection.evidence_ids,
        evidence: state.selection.selection.evidence_ids.flatMap((id) => {
          const match = availableEvidence.find((item) => item.id === id);
          return match ? [match] : [];
        }),
        policyRuleIds: state.selection.selection.policy_rule_ids,
        decisionSummary: renderDecisionSummary(
          state.selection.selection.primary_action_id,
          state.selection.selection.evidence_ids,
          state.selection.selection.policy_rule_ids,
        ),
        toolsUsed: state.selection.toolsUsed,
        humanDecisionRequired: true as const,
        coordination: buildCoordinationPlan(
          state.issue,
          state.selection.selection.primary_action_id,
        ),
      },
    };
  })
  .addEdge(START, "validate_input")
  .addEdge("validate_input", "select_approved_action")
  .addEdge("select_approved_action", "validate_and_render")
  .addEdge("validate_and_render", END)
  .compile();

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { issue?: unknown };
    const issue = validateIssue(body.issue);
    if (!process.env.OPENAI_API_KEY) {
      const actionId = issue.defaultAction;
      return Response.json({
        status: "ready",
        actionId,
        source: "policy_engine",
        evidenceIds: issue.evidence.map((item) => item.id),
        evidence: issue.evidence,
        policyRuleIds: issue.ruleIds,
        decisionSummary:
          renderDecisionSummary(
            actionId,
            issue.evidence.map((item) => item.id),
            issue.ruleIds,
          ),
        toolsUsed: [],
        humanDecisionRequired: true,
        coordination: buildCoordinationPlan(issue, actionId),
      } satisfies RecommendationResult);
    }
    const state = await recommendationGraph.invoke({ issue });
    return Response.json(
      state.result ?? {
        status: "ready",
        actionId: issue.defaultAction,
        source: "policy_engine",
        evidenceIds: issue.evidence.map((item) => item.id),
        evidence: issue.evidence,
        policyRuleIds: issue.ruleIds,
        decisionSummary:
          renderDecisionSummary(
            issue.defaultAction,
            issue.evidence.map((item) => item.id),
            issue.ruleIds,
          ),
        toolsUsed: [],
        humanDecisionRequired: true,
        coordination: buildCoordinationPlan(issue, issue.defaultAction),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return Response.json({ error: message }, { status: 400 });
  }
}
