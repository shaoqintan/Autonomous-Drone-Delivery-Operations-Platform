import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  RESOLUTION_ACTIONS,
  type CoordinationPlan,
  type RecommendationIssue,
  type RecommendationResult,
  type ResolutionAction,
} from "../../lib/recommendations";

type ModelSelection = {
  primary_action_id: ResolutionAction;
  evidence_ids: string[];
  policy_rule_ids: string[];
  draft_message: string;
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

function humanizeAction(action: ResolutionAction) {
  return action
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildCoordinationPlan(
  issue: RecommendationIssue,
  action: ResolutionAction,
  modelDraft?: string,
): CoordinationPlan {
  let contactName = "Operations control";
  let contactRole = "Duty operator";
  let channel = "Ops control";
  let instruction =
    "Please acknowledge this issue, confirm ownership, and post the next verified update here.";

  if (
    action.includes("MAINTENANCE") ||
    action === "GROUND_AIRCRAFT" ||
    action === "AWAIT_VALIDATED_MAINTENANCE_RELEASE"
  ) {
    contactName = "Maintenance team";
    contactRole = "Aircraft maintenance";
    channel = "Maintenance";
    instruction =
      "Please inspect the aircraft, acknowledge ownership, and share the next verified finding here. Do not release the aircraft; the operator must record the validated decision.";
  } else if (
    action === "REESTIMATE_PROMISE_FROM_ACTUAL_READY" ||
    action === "REQUIRE_HANDOFF_VERIFICATION"
  ) {
    contactName = "Merchant partner";
    contactRole = "Merchant operations";
    channel = "Merchant";
    instruction =
      "Please confirm the actual ready time, identify any blocker, and update this thread as soon as the handoff is ready for verification.";
  } else if (
    action === "CUSTOMER_OUTREACH" ||
    action === "MARK_DELIVERY_EXCEPTION"
  ) {
    contactName = "Customer support";
    contactRole = "Delivery support";
    channel = "Customer support";
    instruction =
      "Please contact the customer with the current verified status and post the response or next follow-up time in this thread.";
  } else if (
    action === "HOLD_LAUNCH" ||
    action === "DEFER_ORDER" ||
    action === "REASSIGN_ORDER" ||
    action === "REMOVE_INVALID_ASSIGNMENT"
  ) {
    contactName = "Site dispatch";
    contactRole = "Flight planning";
    channel = "Dispatch";
    instruction =
      "Please acknowledge the operational hold, confirm the affected assignment, and post the revised plan or next review time here.";
  }

  const required = action !== "NO_RECOMMENDATION_INSUFFICIENT_EVIDENCE";
  const fallbackDraft =
    `Hi ${contactName} — Ops opened ${issue.id}: ${issue.title}. ` +
    `${issue.summary} Recommended next action: ${humanizeAction(action)}. ${instruction}`;

  return {
    required,
    channel,
    contactName,
    contactRole,
    subject: `${issue.priority} action needed · ${issue.entity}`,
    draftMessage: modelDraft?.trim() || fallbackDraft,
  };
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
                "or declare a flight safe. Every result requires a human decision. " +
                "Draft one concise coordination message for the team that must act. Do not invent " +
                "names, facts, completion states, or promises. Ask for acknowledgement and a verified update.",
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
              draft_message: {
                type: "string",
                minLength: 20,
                maxLength: 700,
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
              "draft_message",
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
    !selection.policy_rule_ids.every((id) => allowedRules.has(id)) ||
    typeof selection.draft_message !== "string" ||
    selection.draft_message.trim().length < 20
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
      const actionId = state.issue.allowedActions[0];
      return {
        result: {
          status: "ready" as const,
          actionId,
          source: "policy_engine" as const,
          evidenceIds: state.issue.evidence.map((item) => item.id),
          policyRuleIds: state.issue.ruleIds,
          humanDecisionRequired: true as const,
          coordination: buildCoordinationPlan(state.issue, actionId),
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
        coordination: buildCoordinationPlan(
          state.issue,
          state.selection.primary_action_id,
          state.selection.draft_message,
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
      const actionId = issue.allowedActions[0];
      return Response.json({
        status: "ready",
        actionId,
        source: "policy_engine",
        evidenceIds: issue.evidence.map((item) => item.id),
        policyRuleIds: issue.ruleIds,
        humanDecisionRequired: true,
        coordination: buildCoordinationPlan(issue, actionId),
      } satisfies RecommendationResult);
    }
    const state = await recommendationGraph.invoke({ issue });
    return Response.json(
      state.result ?? {
        status: "ready",
        actionId: issue.allowedActions[0],
        source: "policy_engine",
        evidenceIds: issue.evidence.map((item) => item.id),
        policyRuleIds: issue.ruleIds,
        humanDecisionRequired: true,
        coordination: buildCoordinationPlan(issue, issue.allowedActions[0]),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return Response.json({ error: message }, { status: 400 });
  }
}
