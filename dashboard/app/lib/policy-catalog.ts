export type PolicyReference = {
  requestedId: string;
  policyId: string;
  title: string;
  section: string;
  text: string;
  source: string;
  authoritative: boolean;
  note?: string;
};

export type PolicyDocumentSection = {
  title: string;
  paragraphs: Array<{
    policyId: string;
    text: string;
  }>;
};

export const POLICY_DOCUMENT = {
  title: "Fictional Commercial Delivery Policy",
  source: "OPERATING_POLICY.md",
  notice:
    "This is authoritative only for this interview-practice scenario, not real operational guidance.",
  sections: [
    {
      title: "Weather and release",
      paragraphs: [
        {
          policyId: "POL-WEATHER-HOLD",
          text: "Hold launch when sustained wind exceeds 35 kph, gusts exceed 42 kph, or visibility is under 3 km.",
        },
        {
          policyId: "POL-WEATHER-REVIEW",
          text: "An operator review is required at 26–35 kph sustained wind, 34–42 kph gusts, or 3–7 km visibility.",
        },
      ],
    },
    {
      title: "Customer and merchant handling",
      paragraphs: [
        {
          policyId: "POL-VERIFIED-COMPLETION",
          text: "A delivery is successful only after verified completion. A returned or inaccessible drop zone is an exception, not a completion.",
        },
        {
          policyId: "POL-MERCHANT-READY",
          text: "Use actual merchant-ready status, not order acceptance, when estimating a customer promise.",
        },
        {
          policyId: "POL-HUMAN-DECISION",
          text: "For a weather hold or operational exception, the copilot may recommend deferral, cancellation, reassignment, or customer outreach; a human operator owns the decision.",
        },
      ],
    },
    {
      title: "Fleet escalation",
      paragraphs: [
        {
          policyId: "POL-FLEET-GROUND",
          text: "Ground for battery capacity below 80%, cell-voltage spread over 60 mV, or motor vibration over 3.0 mm/s.",
        },
        {
          policyId: "POL-FLEET-RESTRICT",
          text: "Restrict and open a maintenance review for battery capacity 80–84%, spread 45–60 mV, or vibration 2.2–3.0 mm/s.",
        },
        {
          policyId: "POL-NO-AUTHORIZATION",
          text: "The copilot may summarize evidence and policies. It must never state that a flight is authorized or safe to launch.",
        },
      ],
    },
  ] satisfies PolicyDocumentSection[],
};

const AUTHORED_POLICIES: Record<
  string,
  Omit<PolicyReference, "requestedId" | "policyId" | "authoritative">
> = {
  "POL-WEATHER-HOLD": {
    title: "Weather launch hold",
    section: "Weather and release",
    text: "Hold launch when sustained wind exceeds 35 kph, gusts exceed 42 kph, or visibility is under 3 km.",
    source: "OPERATING_POLICY.md",
  },
  "POL-WEATHER-REVIEW": {
    title: "Weather operator review",
    section: "Weather and release",
    text: "An operator review is required at 26–35 kph sustained wind, 34–42 kph gusts, or 3–7 km visibility.",
    source: "OPERATING_POLICY.md",
  },
  "POL-VERIFIED-COMPLETION": {
    title: "Verified delivery completion",
    section: "Customer and merchant handling",
    text: "A delivery is successful only after verified completion. A returned or inaccessible drop zone is an exception, not a completion.",
    source: "OPERATING_POLICY.md",
  },
  "POL-MERCHANT-READY": {
    title: "Actual merchant readiness",
    section: "Customer and merchant handling",
    text: "Use actual merchant-ready status, not order acceptance, when estimating a customer promise.",
    source: "OPERATING_POLICY.md",
  },
  "POL-HUMAN-DECISION": {
    title: "Human-owned operational decision",
    section: "Customer and merchant handling",
    text: "For a weather hold or operational exception, the copilot may recommend deferral, cancellation, reassignment, or customer outreach; a human operator owns the decision.",
    source: "OPERATING_POLICY.md",
  },
  "POL-FLEET-GROUND": {
    title: "Fleet grounding thresholds",
    section: "Fleet escalation",
    text: "Ground for battery capacity below 80%, cell-voltage spread over 60 mV, or motor vibration over 3.0 mm/s.",
    source: "OPERATING_POLICY.md",
  },
  "POL-FLEET-RESTRICT": {
    title: "Fleet restriction thresholds",
    section: "Fleet escalation",
    text: "Restrict and open a maintenance review for battery capacity 80–84%, spread 45–60 mV, or vibration 2.2–3.0 mm/s.",
    source: "OPERATING_POLICY.md",
  },
  "POL-NO-AUTHORIZATION": {
    title: "Copilot authorization boundary",
    section: "Fleet escalation",
    text: "The copilot may summarize evidence and policies. It must never state that a flight is authorized or safe to launch.",
    source: "OPERATING_POLICY.md",
  },
};

const POLICY_ALIASES: Record<string, string> = {
  "POL-WEATHER-WIND": "POL-WEATHER-HOLD",
  "POL-WEATHER-VISIBILITY": "POL-WEATHER-HOLD",
  WX_HOLD_GUST: "POL-WEATHER-HOLD",
  ACTUAL_READINESS_REQUIRED: "POL-MERCHANT-READY",
  ACTUAL_READINESS_PROMISE_BASIS: "POL-MERCHANT-READY",
  "POL-MERCHANT-READINESS-MONITOR": "POL-MERCHANT-READY",
  "POL-BATTERY-CAPACITY": "POL-FLEET-GROUND",
  "POL-CELL-SPREAD": "POL-FLEET-GROUND",
  "POL-MOTOR-VIBRATION": "POL-FLEET-RESTRICT",
  FLEET_GROUND_CAPACITY: "POL-FLEET-GROUND",
  FLEET_GROUND_SPREAD: "POL-FLEET-GROUND",
  DAILY_STATUS_GROUNDED: "POL-FLEET-GROUND",
};

const DERIVED_RULES: Record<string, Omit<PolicyReference, "requestedId">> = {
  "POL-ONE-ACTIVE-ASSIGNMENT": {
    policyId: "POL-ONE-ACTIVE-ASSIGNMENT",
    title: "Single-aircraft assignment constraint",
    section: "Simulator operational control",
    text: "The simulator prevents one aircraft from being dispatched to overlapping operations until a human selects the valid assignment.",
    source: "Dashboard deterministic control",
    authoritative: false,
    note: "This is an application control, not an authored clause in OPERATING_POLICY.md.",
  },
  CONFLICTING_STRUCTURED_RECORDS: {
    policyId: "CONFLICTING_STRUCTURED_RECORDS",
    title: "Conflicting source records",
    section: "Dashboard data-integrity control",
    text: "The dashboard requires human review when structured records disagree about the same operation.",
    source: "Dashboard deterministic control",
    authoritative: false,
    note: "This is an application control, not an authored clause in OPERATING_POLICY.md.",
  },
  HISTORICAL_READINESS_PATTERN: {
    policyId: "HISTORICAL_READINESS_PATTERN",
    title: "Historical readiness pattern",
    section: "Analytical trigger",
    text: "A recurring readiness-delay pattern was detected in historical data.",
    source: "Historical analysis",
    authoritative: false,
    note: "This is an analytical trigger, not an authored policy clause.",
  },
  HISTORICAL_TETHER_PATTERN: {
    policyId: "HISTORICAL_TETHER_PATTERN",
    title: "Historical tether pattern",
    section: "Analytical trigger",
    text: "A recurring tether-descent variance was detected in historical telemetry.",
    source: "Historical analysis",
    authoritative: false,
    note: "This is an analytical trigger, not an authored policy clause.",
  },
};

export function getPolicyReference(ruleId: string): PolicyReference {
  const canonicalId = POLICY_ALIASES[ruleId] ?? ruleId;
  const authored = AUTHORED_POLICIES[canonicalId];
  if (authored) {
    return {
      requestedId: ruleId,
      policyId: canonicalId,
      ...authored,
      authoritative: true,
      note:
        canonicalId !== ruleId
          ? `${ruleId} is the triggered condition mapped to this authored policy clause.`
          : undefined,
    };
  }
  const derived = DERIVED_RULES[ruleId];
  if (derived) return { requestedId: ruleId, ...derived };
  return {
    requestedId: ruleId,
    policyId: ruleId,
    title: ruleId.replaceAll("_", " ").replaceAll("-", " "),
    section: "Unmapped reference",
    text: "No authored policy text is available for this reference.",
    source: "Unavailable",
    authoritative: false,
    note: "Do not treat this reference as an authored operating-policy clause.",
  };
}
