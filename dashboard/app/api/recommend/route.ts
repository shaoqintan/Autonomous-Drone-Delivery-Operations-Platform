import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  RESOLUTION_ACTIONS,
  type RecommendationIssue,
  type RecommendationResult,
  type ResolutionAction,
} from "../../lib/recommendations";

type ModelSelection = {
  primary_action_id: ResolutionAction;
  evidence_ids: string[];
  policy_rule_ids: string[];
  human_decision_required: true;
};

const GraphState = Annotation.Root({
  issue: Annotation<RecommendationIssue>,
  selection: Annotation<ModelSelection | null>({
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
    !issue.allowedActions.every(isResolutionAction)
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

async function chooseWithOpenAI(
  issue: RecommendationIssue,
): Promise<ModelSelection | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const evidenceIds = issue.evidence.map((item) => item.id);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      reasoning: { effort: "low" },
      store: false,
      max_output_tokens: 260,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are a constrained operations recommendation selector. " +
                "Policy decisions and priority are already final. Select exactly one allowed action. " +
                "Use only supplied evidence and triggered rule IDs. Never authorize, clear, release, " +
                "or declare a flight safe. Every result requires a human decision.",
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
                launch_blocking: issue.launchBlocking,
                allowed_action_ids: issue.allowedActions,
                triggered_policy_rule_ids: issue.ruleIds,
                evidence: issue.evidence,
              }),
            },
          ],
        },
      ],
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
                items: { type: "string", enum: evidenceIds },
                minItems: 1,
              },
              policy_rule_ids: {
                type: "array",
                items: { type: "string", enum: issue.ruleIds },
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
  const raw = await response.json();
  const text = extractOutputText(raw);
  if (!text) return null;

  let selection: ModelSelection;
  try {
    selection = JSON.parse(text) as ModelSelection;
  } catch {
    return null;
  }

  const allowedActions = new Set(issue.allowedActions);
  const allowedEvidence = new Set(evidenceIds);
  const allowedRules = new Set(issue.ruleIds);
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
  return selection;
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
      return {
        result: {
          status: "unavailable" as const,
          actionId: null,
          source: null,
          evidenceIds: [] as [],
          policyRuleIds: [] as [],
          humanDecisionRequired: true as const,
        },
      };
    }
    return {
      result: {
        status: "ready" as const,
        actionId: state.selection.primary_action_id,
        source: "openai" as const,
        evidenceIds: state.selection.evidence_ids,
        policyRuleIds: state.selection.policy_rule_ids,
        humanDecisionRequired: true as const,
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
      return Response.json({
        status: "not_configured",
        actionId: null,
        source: null,
        evidenceIds: [],
        policyRuleIds: [],
        humanDecisionRequired: true,
      } satisfies RecommendationResult);
    }
    const state = await recommendationGraph.invoke({ issue });
    return Response.json(
      state.result ?? {
        status: "unavailable",
        actionId: null,
        source: null,
        evidenceIds: [],
        policyRuleIds: [],
        humanDecisionRequired: true,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return Response.json({ error: message }, { status: 400 });
  }
}
