export const RESOLUTION_ACTIONS = [
  "HOLD_LAUNCH",
  "GROUND_AIRCRAFT",
  "RESTRICT_AND_OPEN_MAINTENANCE_REVIEW",
  "OPEN_OPERATOR_REVIEW",
  "DEFER_ORDER",
  "CANCEL_ORDER",
  "REASSIGN_ORDER",
  "CUSTOMER_OUTREACH",
  "REESTIMATE_PROMISE_FROM_ACTUAL_READY",
  "REQUIRE_HANDOFF_VERIFICATION",
  "MARK_DELIVERY_EXCEPTION",
  "REMOVE_INVALID_ASSIGNMENT",
  "AWAIT_VALIDATED_MAINTENANCE_RELEASE",
  "NO_RECOMMENDATION_INSUFFICIENT_EVIDENCE",
] as const;

export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

export type RecommendationEvidence = {
  id: string;
  dataset: string;
  label: string;
  value: string;
  timestamp: string;
};

export type RecommendationIssue = {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  category: string;
  title: string;
  summary: string;
  entity: string;
  ruleIds: string[];
  evidence: RecommendationEvidence[];
  allowedActions: ResolutionAction[];
  launchBlocking: boolean;
  humanDecisionRequired: true;
};

export type CoordinationPlan = {
  required: boolean;
  channel: string;
  contactName: string;
  contactRole: string;
  subject: string;
  draftMessage: string;
};

export type RecommendationResult = {
  status: "ready";
  actionId: ResolutionAction;
  source: "openai" | "policy_engine";
  evidenceIds: string[];
  policyRuleIds: string[];
  humanDecisionRequired: true;
  coordination: CoordinationPlan;
};
