import {
  getVectorIndexStatus,
  searchVectorIndex,
  type VectorMatch,
} from "./vector-search";

export type SimilarIncidentIssue = {
  id: string;
  title: string;
  summary: string;
  category: string;
  entity: string;
  effect: string;
  ruleIds: string[];
  evidence: Array<{
    label: string;
    value: string;
    dataset: string;
  }>;
};

export type SimilarIncidentMatch = {
  id: string;
  title: string;
  date: string;
  dataset: string;
  sourceType: string;
  similarity: number;
  problem: string;
  solution: string;
  outcome: string;
  matchReasons: string[];
  synthetic: boolean;
};

export type SimilarIncidentResult = {
  status: "ready";
  summary: string;
  retrievalMethod: string;
  index: ReturnType<typeof getVectorIndexStatus>;
  matches: SimilarIncidentMatch[];
};

const TOPIC_BY_EFFECT: Record<string, string> = {
  site_weather_hold: "weather",
  aircraft_ground: "fleet",
  aircraft_restrict: "fleet",
  order_readiness_hold: "merchant",
  assignment_conflict: "operations",
  advisory: "customer",
};

const RESOLUTION_LIBRARY: Record<
  string,
  { solution: string; outcome: string }
> = {
  "CR-001": {
    solution:
      "Separate order acceptance from physical readiness, expose readiness uncertainty, and base the promise on the actual ready event.",
    outcome:
      "The incident established the control now used to prevent premature launch planning and unrealistic customer promises.",
  },
  "CR-002": {
    solution:
      "Restrict the aircraft, ground it after the battery trend was confirmed, and replace the battery pack before another customer flight.",
    outcome:
      "The aircraft was removed before a customer-facing failure; the linked validation record later returned it to service.",
  },
  "CR-003": {
    solution:
      "Replace the battery pack, then require validation missions with normal temperature and consumption readings before release.",
    outcome:
      "Validation missions stayed within normal bounds and maintenance recorded a validated return to service.",
  },
  "CR-004": {
    solution:
      "Place the site under a temporary delivery hold, then defer or cancel affected orders through the service-recovery workflow.",
    outcome:
      "No new launch was attempted during the wind exception; operations resumed only after the hold condition cleared.",
  },
  "CR-005": {
    solution:
      "Block all launches while visibility remained below the release threshold and continue monitoring until readings normalized.",
    outcome:
      "The low-visibility window passed without launching into an out-of-policy condition.",
  },
  "CR-006": {
    solution:
      "Remove the aircraft from service, inspect and service the tether descent motor, then complete validation before release.",
    outcome:
      "The aircraft returned only after a validated maintenance release.",
  },
  "CR-007": {
    solution:
      "Return conservatively, mark the delivery as an exception, and hand the case to support for customer recovery.",
    outcome:
      "The inaccessible delivery was not misreported as successful, and support handled the customer resolution.",
  },
  "CR-008": {
    solution:
      "Stop the handoff, follow the payload-mismatch exception workflow, and route the affected order to customer support.",
    outcome:
      "The mismatched handoff was contained and support resolved the affected order.",
  },
  "MNT-001": {
    solution:
      "Replace the battery pack after cell-voltage imbalance and high-consumption trends were confirmed.",
    outcome:
      "Maintenance recorded a validated return to service after the corrective work.",
  },
  "MNT-002": {
    solution:
      "Service the tether descent motor after repeated descent-time variability.",
    outcome:
      "Maintenance recorded a validated return to service after the corrective work.",
  },
};

const DEMO_FALLBACKS: Record<string, SimilarIncidentMatch> = {
  assignment_conflict: {
    id: "DEMO-ASG-014",
    title: "Overlapping aircraft assignment corrected before launch",
    date: "2025-06-12",
    dataset: "demo_incident_library",
    sourceType: "demo",
    similarity: 82,
    problem:
      "Two preflight orders were assigned to the same aircraft in overlapping launch windows.",
    solution:
      "Dispatch retained the higher-priority assignment, removed the duplicate aircraft allocation, and requeued the second order for reassignment.",
    outcome:
      "The conflict cleared before launch and the second order received a new aircraft after a capacity check.",
    matchReasons: ["Same assignment conflict", "Same preflight stage"],
    synthetic: true,
  },
  default: {
    id: "DEMO-OPS-021",
    title: "Comparable operational exception resolved by operator review",
    date: "2025-06-18",
    dataset: "demo_incident_library",
    sourceType: "demo",
    similarity: 68,
    problem:
      "A comparable exception blocked the operation while the available source records were reviewed.",
    solution:
      "The operator kept the hold in place, verified the conflicting evidence, assigned an owner, and documented the final decision.",
    outcome:
      "The workflow resumed only after the evidence was reconciled and the operator recorded the resolution.",
    matchReasons: ["Same operational workflow"],
    synthetic: true,
  },
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replaceAll("_", " ");
}

function buildQuery(issue: SimilarIncidentIssue) {
  return [
    issue.category,
    issue.title,
    issue.summary,
    issue.effect,
    issue.entity,
    ...issue.ruleIds,
    ...issue.evidence.flatMap((item) => [item.label, item.value]),
  ]
    .filter(Boolean)
    .join(" ");
}

function rankMatch(match: VectorMatch, issue: SimilarIncidentIssue) {
  const targetTopic = TOPIC_BY_EFFECT[issue.effect] ?? normalize(issue.category);
  const topicMatches =
    normalize(match.metadata.topic).includes(targetTopic) ||
    targetTopic.includes(normalize(match.metadata.topic));
  const genericHandover =
    normalize(match.metadata.title) === "commercial delivery shift handover";
  const sourceBonus =
    match.metadata.sourceType === "incident"
      ? 0.22
      : match.metadata.sourceType === "maintenance"
        ? 0.16
        : 0.08;
  return (
    match.score +
    (topicMatches ? 0.42 : 0) +
    sourceBonus -
    (genericHandover ? 0.35 : 0)
  );
}

function displaySimilarity(score: number, rank: number) {
  if (process.env.OPENAI_API_KEY?.trim() && score <= 1) {
    return Math.max(54, Math.min(96, Math.round(score * 100)));
  }
  return Math.max(58, 91 - rank * 7);
}

function extractAfter(text: string, label: string) {
  const match = text.match(new RegExp(`${label}:\\s*([^\\.]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function genericResolution(match: VectorMatch) {
  if (match.metadata.sourceType === "maintenance") {
    const action = extractAfter(match.text, "Action") ?? "complete corrective maintenance";
    const component = extractAfter(match.text, "Component");
    const release = extractAfter(match.text, "Release status");
    return {
      solution: `${action.charAt(0).toUpperCase()}${action.slice(1)}${
        component ? ` for ${component.replaceAll("_", " ")}` : ""
      }.`,
      outcome: release
        ? `The release status was recorded as ${release.replaceAll("_", " ")}.`
        : "The maintenance record documents the corrective action and release decision.",
    };
  }
  if (match.metadata.sourceType === "support") {
    const resolution = extractAfter(match.text, "Resolution");
    return {
      solution: resolution
        ? `${resolution.charAt(0).toUpperCase()}${resolution.slice(1)}.`
        : "Customer support followed the recorded service-recovery workflow.",
      outcome:
        "The support record preserves the customer resolution and final sentiment for review.",
    };
  }
  return {
    solution:
      "Review the linked incident narrative and repeat the documented containment steps that apply to the current evidence.",
    outcome:
      "The archive records this as a prior operational outcome; operator review is still required before reusing the approach.",
  };
}

function matchReasons(match: VectorMatch, issue: SimilarIncidentIssue) {
  const reasons: string[] = [];
  const targetTopic = TOPIC_BY_EFFECT[issue.effect] ?? normalize(issue.category);
  if (
    normalize(match.metadata.topic).includes(targetTopic) ||
    targetTopic.includes(normalize(match.metadata.topic))
  ) {
    reasons.push(`Same ${targetTopic} issue type`);
  }
  if (
    match.metadata.droneId &&
    normalize(issue.entity).includes(normalize(match.metadata.droneId))
  ) {
    reasons.push("Same aircraft");
  }
  if (
    issue.evidence.some((item) =>
      normalize(match.text).includes(normalize(item.label)),
    )
  ) {
    reasons.push("Matching evidence signal");
  }
  if (match.metadata.sourceType === "maintenance") {
    reasons.push("Includes corrective maintenance");
  } else if (match.metadata.sourceType === "support") {
    reasons.push("Includes customer resolution");
  } else {
    reasons.push("Similar incident narrative");
  }
  return [...new Set(reasons)].slice(0, 3);
}

function toIncidentMatch(
  match: VectorMatch,
  issue: SimilarIncidentIssue,
  rank: number,
): SimilarIncidentMatch {
  const resolution =
    RESOLUTION_LIBRARY[match.metadata.sourceId] ?? genericResolution(match);
  return {
    id: match.metadata.sourceId,
    title: match.metadata.title,
    date: match.metadata.date,
    dataset: match.metadata.dataset,
    sourceType: match.metadata.sourceType,
    similarity: displaySimilarity(match.score, rank),
    problem: match.text,
    solution: resolution.solution,
    outcome: resolution.outcome,
    matchReasons: matchReasons(match, issue),
    synthetic: false,
  };
}

export async function findSimilarIncidentSolutions(
  issue: SimilarIncidentIssue,
): Promise<SimilarIncidentResult> {
  const query = buildQuery(issue);
  const vectorMatches = await searchVectorIndex({
    query,
    sourceTypes: ["incident", "maintenance", "support", "operator_note"],
    limit: 12,
  });
  const uniqueMatches = [...vectorMatches]
    .sort((left, right) => rankMatch(right, issue) - rankMatch(left, issue))
    .filter(
      (match, index, source) =>
        source.findIndex(
          (candidate) =>
            candidate.metadata.sourceId === match.metadata.sourceId,
        ) === index,
    )
    .slice(0, 3)
    .map((match, rank) => toIncidentMatch(match, issue, rank));

  const needsCorrespondingDemo =
    issue.effect === "assignment_conflict" &&
    !uniqueMatches.some((match) =>
      normalize(`${match.title} ${match.problem}`).includes("assign"),
    );
  const matches = needsCorrespondingDemo
    ? [DEMO_FALLBACKS.assignment_conflict, ...uniqueMatches.slice(0, 2)]
    : uniqueMatches.length
      ? uniqueMatches
      : [DEMO_FALLBACKS[issue.effect] ?? DEMO_FALLBACKS.default];
  const syntheticCount = matches.filter((match) => match.synthetic).length;

  return {
    status: "ready",
    summary:
      syntheticCount > 0
        ? `Found ${matches.length - syntheticCount} archive matches and added ${syntheticCount} clearly labeled demo example where the archive had no close resolution.`
        : `Found ${matches.length} related historical records and ranked them by operational similarity.`,
    retrievalMethod: process.env.OPENAI_API_KEY?.trim()
      ? "Query embedding, cosine similarity, issue-type reranking, and structured resolution extraction"
      : "Indexed archive search with issue-type reranking and structured resolution extraction",
    index: getVectorIndexStatus(),
    matches,
  };
}
