"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  CloudSun,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  History,
  ListFilter,
  MapPin,
  Maximize2,
  MessageSquare,
  Minimize2,
  PackageCheck,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Table2,
  UserRound,
  Wind,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HistoryWorkspace } from "./history-workspace";
import {
  createSimulationSeed,
  generateSimulation,
} from "./lib/simulation";
import {
  getPolicyReference,
  POLICY_DOCUMENT,
  type PolicyReference,
} from "./lib/policy-catalog";

type View = "fleet" | "orders" | "issues" | "history";

type Evidence = {
  id: string;
  dataset: string;
  label: string;
  value: string;
  timestamp: string;
};

type Issue = {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  category: string;
  title: string;
  summary: string;
  entity: string;
  ruleIds: string[];
  evidence: Evidence[];
  allowedActions: string[];
  defaultAction: string;
  createdAt: string;
  launchBlocking: boolean;
  humanDecisionRequired: boolean;
  status: string;
  effect:
    | "site_weather_hold"
    | "aircraft_ground"
    | "aircraft_restrict"
    | "order_readiness_hold"
    | "assignment_conflict"
    | "advisory";
  clearanceMode: "automatic" | "human_release" | "manual_resolution";
  recoveryAt: string | null;
  recoveryLabel: string | null;
  recoveryEvidence: Evidence[];
  affectedOrderIds: string[];
  affectedDroneIds: string[];
};

type Drone = {
  droneId: string;
  site: string;
  siteLabel: string;
  status: string;
  activity: string;
  flightId: string | null;
  orderId: string | null;
  batteryLevel: number | null;
  batteryCapacity: number;
  cellSpread: number;
  vibration: number;
  batteryTemp: number | null;
  gpsHdop: number | null;
  tetherDescent: number;
  phase: string | null;
  lastTelemetryAt: string | null;
  healthStatus: string;
  policyState: string;
  policyRules: string[];
  activeFlightCount: number;
  upcomingFlightCount: number;
  assignmentConflict: boolean;
};

type PreflightCheck = {
  label: string;
  state: "clear" | "review" | "blocked";
  detail: string;
};

type Order = {
  orderId: string;
  flightId: string;
  droneId: string;
  merchantId: string;
  merchant: string;
  merchantCategory: string;
  site: string;
  siteLabel: string;
  zone: string;
  serviceLevel: string;
  promisedMinutes: number;
  requestedAt: string;
  launchAt: string;
  deliveredAt: string | null;
  minutesToLaunch: number;
  status: string;
  readinessStatus: string;
  readinessLabel: string;
  readinessEventAt: string | null;
  handoffVerified: boolean | null;
  payloadKg: number;
  distanceKm: number;
  preflightState: string | null;
  preflightChecks: PreflightCheck[];
};

type Weather = {
  site: string;
  siteLabel: string;
  wind: number;
  gust: number;
  visibility: number;
  condition: string;
  policyState: string;
  ruleIds: string[];
  observedAt: string;
  affectedFlights: number;
};

type Scenario = {
  id: string;
  runId: string;
  seed: string;
  label: string;
  description: string;
  now: string;
  timelineStart: string;
  timelineEnd: string;
  generatedFrom: string[];
  summary: {
    airborne: number;
    preflight: number;
    grounded: number;
    conflicts: number;
    openIssues: number;
    criticalIssues: number;
  };
  weather: Weather[];
  drones: Drone[];
  orders: Order[];
  issues: Issue[];
};

type RecommendationResult =
  {
    status: "ready";
    actionId: string;
    source: "openai" | "policy_engine";
    evidenceIds: string[];
    evidence: Evidence[];
    policyRuleIds: string[];
    decisionSummary: string;
    toolsUsed: Array<{
      name: string;
      summary: string;
      evidenceCount: number;
    }>;
    humanDecisionRequired: true;
    coordination: {
      required: boolean;
      channel: string;
      contactName: string;
      contactRole: string;
      subject: string;
      draftMessage: string;
    };
  };

type TicketStatus = "new" | "in_progress" | "waiting" | "resolved";

type TicketRecord = {
  issueId: string;
  scenarioId: string;
  status: TicketStatus;
  owner: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

type ChatMessage = {
  id: number;
  issueId: string;
  channel: string;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: string;
};

type MessageRecipient = {
  channel: string;
  name: string;
  role: string;
};

type IssueLifecycleState =
  | "condition_active"
  | "ready_for_release"
  | "released"
  | "auto_cleared"
  | "manual";

type IssueLifecycle = {
  state: IssueLifecycleState;
  blocksOperations: boolean;
  label: string;
};

type OperationalNotice = {
  id: string;
  issueId: string;
  title: string;
  detail: string;
};

type OpenReference =
  | { kind: "policy"; value: PolicyReference }
  | { kind: "evidence"; value: Evidence };

const REPLAY_TICK_MS = 750;
const DEFAULT_REPLAY_SPEED = 1;
const ISSUE_TICKETS_KEY = "zipline-issue-tickets-v1";
const ISSUE_MESSAGES_KEY = "zipline-issue-messages-v1";
const RELEASE_APPROVALS_KEY = "zipline-release-approvals-v1";
const CONFLICT_RESOLUTIONS_KEY = "zipline-conflict-resolutions-v1";
const SIMULATION_RUN_KEY = "zipline-simulation-run-v1";

const MESSAGE_RECIPIENTS: MessageRecipient[] = [
  {
    channel: "Ops control",
    name: "Operations control",
    role: "Duty operator",
  },
  {
    channel: "Maintenance",
    name: "Maintenance team",
    role: "Aircraft maintenance",
  },
  {
    channel: "Flight operations",
    name: "Flight operations",
    role: "Flight coordinator",
  },
  {
    channel: "Merchant",
    name: "Merchant partner",
    role: "Merchant operations",
  },
  {
    channel: "Customer support",
    name: "Customer support",
    role: "Delivery support",
  },
  {
    channel: "Site lead",
    name: "Site lead",
    role: "Fulfillment-site supervisor",
  },
];

const statusLabels: Record<string, string> = {
  in_flight: "In flight",
  preflight: "Preflight",
  idle: "Idle",
  grounded: "Grounded",
  maintenance: "Maintenance",
  review: "Review",
  conflict: "Conflict",
  delivered: "Delivered",
  delivered_late: "Delivered late",
  cancelled: "Cancelled",
  exception: "Exception",
};

const preflightLabels: Record<string, string> = {
  CHECK_INCOMPLETE: "Check incomplete",
  POLICY_HOLD_REQUIRED: "Policy hold required",
  POLICY_GROUND_REQUIRED: "Policy ground required",
  POLICY_RESTRICT_REVIEW_REQUIRED: "Restriction review required",
  OPERATOR_REVIEW_REQUIRED: "Operator review required",
  NO_POLICY_EXCEPTION_DETECTED: "No policy exception detected",
};

function formatTime(value: string | null, includeDate = false) {
  if (!value) return "No live reading";
  return new Intl.DateTimeFormat("en-US", {
    month: includeDate ? "short" : undefined,
    day: includeDate ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function displayService(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildImmediateRecommendation(issue: Issue): RecommendationResult {
  const actionId = issue.defaultAction;
  let contactName = "Operations control";
  let contactRole = "Duty operator";
  let channel = "Ops control";
  let instruction = "Confirm owner and ETA.";

  if (
    actionId.includes("MAINTENANCE") ||
    actionId === "GROUND_AIRCRAFT" ||
    actionId === "AWAIT_VALIDATED_MAINTENANCE_RELEASE"
  ) {
    contactName = "Maintenance team";
    contactRole = "Aircraft maintenance";
    channel = "Maintenance";
    instruction = `Inspect ${issue.entity}. Share findings and ETA.`;
  } else if (
    actionId === "REESTIMATE_PROMISE_FROM_ACTUAL_READY" ||
    actionId === "REQUIRE_HANDOFF_VERIFICATION"
  ) {
    contactName = "Merchant partner";
    contactRole = "Merchant operations";
    channel = "Merchant";
    instruction = `Confirm ready time and blockers for ${issue.entity}.`;
  } else if (
    actionId === "CUSTOMER_OUTREACH" ||
    actionId === "MARK_DELIVERY_EXCEPTION"
  ) {
    contactName = "Customer support";
    contactRole = "Delivery support";
    channel = "Customer support";
    instruction = "Update the customer and post the response.";
  } else if (
    actionId === "HOLD_LAUNCH" ||
    actionId === "DEFER_ORDER" ||
    actionId === "REASSIGN_ORDER" ||
    actionId === "REMOVE_INVALID_ASSIGNMENT"
  ) {
    contactName = "Site dispatch";
    contactRole = "Flight planning";
    channel = "Dispatch";
    instruction = "Confirm the hold and revised plan.";
  }

  return {
    status: "ready",
    actionId,
    source: "policy_engine",
    evidenceIds: issue.evidence.map((item) => item.id),
    evidence: issue.evidence,
    policyRuleIds: issue.ruleIds,
    decisionSummary:
      "Selected the first action allowed by the deterministic policy result. Connect OPENAI_API_KEY to enable autonomous tool selection.",
    toolsUsed: [],
    humanDecisionRequired: true,
    coordination: {
      required: actionId !== "NO_RECOMMENDATION_INSUFFICIENT_EVIDENCE",
      channel,
      contactName,
      contactRole,
      subject: `${issue.priority} action needed · ${issue.entity}`,
      draftMessage: `${issue.title}: ${issue.summary} ${instruction}`,
    },
  };
}

function projectOrderAtTime(order: Order, replayTime: number): Order | null {
  const requestedAt = Date.parse(order.requestedAt);
  if (requestedAt > replayTime) return null;

  const launchAt = Date.parse(order.launchAt);
  const deliveredAt = order.deliveredAt ? Date.parse(order.deliveredAt) : null;
  const readinessVisible =
    order.readinessEventAt !== null && Date.parse(order.readinessEventAt) <= replayTime;

  let status = order.status;
  if (order.status === "cancelled" && launchAt <= replayTime) {
    status = "cancelled";
  } else if (deliveredAt !== null && deliveredAt <= replayTime) {
    status = order.status === "delivered_late" ? "delivered_late" : "delivered";
  } else if (launchAt <= replayTime && deliveredAt !== null && replayTime < deliveredAt) {
    status = "in_flight";
  } else if (launchAt > replayTime) {
    status = "preflight";
  }

  const projectedReadinessStatus = readinessVisible
    ? order.readinessStatus
    : "awaiting_event";
  const projectedReadinessLabel = readinessVisible
    ? order.readinessLabel
    : "Awaiting actual readiness";
  const projectedHandoff = readinessVisible ? order.handoffVerified : null;
  const projectedChecks =
    status === "preflight"
      ? order.preflightChecks.map((check) =>
          check.label === "Merchant readiness"
            ? {
                ...check,
                state:
                  readinessVisible && projectedHandoff === true
                    ? ("clear" as const)
                    : ("blocked" as const),
                detail: projectedReadinessLabel,
              }
            : check,
        )
      : [];
  const projectedPreflightState =
    status !== "preflight"
      ? null
      : projectedChecks.some((check) => check.state === "blocked")
        ? "CHECK_INCOMPLETE"
        : projectedChecks.some((check) => check.state === "review")
          ? "OPERATOR_REVIEW_REQUIRED"
          : "NO_POLICY_EXCEPTION_DETECTED";

  return {
    ...order,
    status,
    minutesToLaunch: Math.floor((launchAt - replayTime) / 60_000),
    readinessStatus: projectedReadinessStatus,
    readinessLabel: projectedReadinessLabel,
    handoffVerified: projectedHandoff,
    preflightState: projectedPreflightState,
    preflightChecks: projectedChecks,
  };
}

function lifecycleForIssue(
  issue: Issue,
  replayTime: number,
  ticket: TicketRecord | undefined,
  approvedAt: string | undefined,
): IssueLifecycle {
  const recovered =
    issue.recoveryAt !== null && Date.parse(issue.recoveryAt) <= replayTime;

  if (issue.clearanceMode === "automatic") {
    return recovered
      ? {
          state: "auto_cleared",
          blocksOperations: false,
          label: issue.recoveryLabel ?? "Condition cleared automatically",
        }
      : {
          state: "condition_active",
          blocksOperations: issue.effect !== "advisory",
          label: "Condition active · automatic monitoring",
        };
  }

  if (issue.clearanceMode === "human_release") {
    if (approvedAt && Date.parse(approvedAt) <= replayTime) {
      return {
        state: "released",
        blocksOperations: false,
        label: "Operator release approved",
      };
    }
    if (recovered) {
      return {
        state: "ready_for_release",
        blocksOperations: true,
        label: issue.recoveryLabel ?? "Condition cleared · operator release required",
      };
    }
    return {
      state: "condition_active",
      blocksOperations: true,
      label: "Safety condition active · operations automatically held",
    };
  }

  const manuallyResolved = ticket?.status === "resolved";
  return {
    state: "manual",
    blocksOperations: issue.effect !== "advisory" && !manuallyResolved,
    label: manuallyResolved ? "Operator workflow completed" : "Human resolution required",
  };
}

function adjustOrderForApprovals(
  order: Order,
  issues: Issue[],
  approvals: Record<string, string>,
  replayTime: number,
) {
  const originalLaunch = Date.parse(order.launchAt);
  const requiredRelease = issues
    .filter(
      (issue) =>
        issue.clearanceMode === "human_release" &&
        issue.affectedOrderIds.includes(order.orderId) &&
        Date.parse(issue.createdAt) <= originalLaunch &&
        approvals[issue.id] &&
        Date.parse(approvals[issue.id]) <= replayTime,
    )
    .reduce(
      (latest, issue) =>
        Math.max(latest, Date.parse(approvals[issue.id]) + 5 * 60_000),
      originalLaunch,
    );

  if (requiredRelease <= originalLaunch) return order;
  const shift = requiredRelease - originalLaunch;
  return {
    ...order,
    launchAt: new Date(requiredRelease).toISOString(),
    deliveredAt: order.deliveredAt
      ? new Date(Date.parse(order.deliveredAt) + shift).toISOString()
      : null,
  };
}

function createUnifiedScenario(source: Scenario[]): Scenario {
  const orderedScenarios = [...source].sort(
    (a, b) => Date.parse(a.timelineStart) - Date.parse(b.timelineStart),
  );
  const orders = orderedScenarios.flatMap((item) => item.orders);
  const issues = orderedScenarios.flatMap((item) => item.issues);
  const weather = orderedScenarios.flatMap((item) => item.weather);
  orders.sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
  issues.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const statusRank: Record<string, number> = {
    idle: 0,
    in_flight: 1,
    preflight: 2,
    conflict: 3,
    review: 4,
    maintenance: 5,
    grounded: 6,
  };
  const dronesById = new Map<string, Drone>();
  for (const sourceScenario of orderedScenarios) {
    for (const drone of sourceScenario.drones) {
      const current = dronesById.get(drone.droneId);
      if (
        !current ||
        (statusRank[drone.status] ?? 0) > (statusRank[current.status] ?? 0)
      ) {
        dronesById.set(drone.droneId, drone);
      }
    }
  }

  const timelineStart = Math.min(
    ...orders.map((order) => Date.parse(order.requestedAt)),
    ...issues.map((issue) => Date.parse(issue.createdAt)),
    ...weather.map((reading) => Date.parse(reading.observedAt)),
  );
  const timelineEnd = Math.max(
    ...orderedScenarios.map((item) => Date.parse(item.timelineEnd)),
    ...orders.map((order) =>
      Date.parse(order.deliveredAt ?? order.launchAt),
    ),
    ...issues
      .filter((issue) => issue.recoveryAt)
      .map((issue) => Date.parse(issue.recoveryAt as string)),
    ...weather.map((reading) => Date.parse(reading.observedAt)),
  );

  return {
    id: "operations-shift",
    runId: "operations-shift",
    seed: "legacy-replay",
    label: "Operations shift",
    description: "",
    now: new Date(timelineEnd).toISOString(),
    timelineStart: new Date(timelineStart).toISOString(),
    timelineEnd: new Date(timelineEnd).toISOString(),
    generatedFrom: [...new Set(source.flatMap((item) => item.generatedFrom))],
    summary: {
      airborne: 0,
      preflight: 0,
      grounded: 0,
      conflicts: 0,
      openIssues: issues.length,
      criticalIssues: issues.filter((issue) => issue.priority === "P0").length,
    },
    weather,
    drones: [...dronesById.values()],
    orders,
    issues,
  };
}

function createReplayEvents(scenario: Scenario) {
  return [
    Date.parse(scenario.timelineStart),
    ...scenario.orders.flatMap((order) => [
      Date.parse(order.requestedAt),
      Date.parse(order.launchAt),
      ...(order.readinessEventAt ? [Date.parse(order.readinessEventAt)] : []),
      ...(order.deliveredAt ? [Date.parse(order.deliveredAt)] : []),
    ]),
    ...scenario.issues.map((issue) => Date.parse(issue.createdAt)),
    ...scenario.issues
    .filter((issue) => issue.recoveryAt)
    .map((issue) => Date.parse(issue.recoveryAt as string)),
    ...scenario.weather.map((reading) => Date.parse(reading.observedAt)),
    Date.parse(scenario.timelineEnd),
  ]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .filter(
      (value, index, values) => index === 0 || value !== values[index - 1],
    );
}

function PriorityChip({ priority }: { priority: Issue["priority"] }) {
  return <span className={`priority-chip priority-${priority.toLowerCase()}`}>{priority}</span>;
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`status-chip status-${status}`}>
      <span className="status-dot" />
      {statusLabels[status] ?? displayService(status)}
    </span>
  );
}

function Metric({
  label,
  value,
  suffix,
  tone = "default",
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: "default" | "violet" | "critical";
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>
        {value}
        {suffix && <small>{suffix}</small>}
      </strong>
    </div>
  );
}

export function OperationsDashboard({
  initialScenario,
}: {
  initialScenario: Scenario;
}) {
  const [scenario, setScenario] = useState(initialScenario);
  const [view, setView] = useState<View>("fleet");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [replaySpeed, setReplaySpeed] = useState(DEFAULT_REPLAY_SPEED);
  const [fleetQuery, setFleetQuery] = useState("");
  const [fleetFilter, setFleetFilter] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState("all");
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueQueue, setIssueQueue] = useState<string[]>([]);
  const [toastIssueId, setToastIssueId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Record<string, RecommendationResult>>({});
  const [recommendationLoading, setRecommendationLoading] = useState<Record<string, boolean>>({});
  const [ticketRecords, setTicketRecords] = useState<Record<string, TicketRecord>>({});
  const [messagesByIssue, setMessagesByIssue] = useState<Record<string, ChatMessage[]>>({});
  const [releaseApprovals, setReleaseApprovals] = useState<Record<string, string>>({});
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, string>>({});
  const [operationalNoticeQueue, setOperationalNoticeQueue] = useState<OperationalNotice[]>([]);
  const [operationalNotice, setOperationalNotice] = useState<OperationalNotice | null>(null);
  const [workflowBusy] = useState<Record<string, boolean>>({});
  const [workflowLoaded, setWorkflowLoaded] = useState(false);
  const recommendationRequests = useRef(new Set<string>());
  const previousLifecycleStates = useRef(new Map<string, IssueLifecycleState>());
  const previousReplayTime = useRef(Date.parse(initialScenario.timelineStart));
  const notifiedIssueIds = useRef(
    new Set(
      initialScenario.issues
        .filter(
          (issue) =>
            Date.parse(issue.createdAt) <=
            Date.parse(initialScenario.timelineStart),
        )
        .map((issue) => issue.id),
    ),
  );

  const replayEvents = useMemo(() => createReplayEvents(scenario), [scenario]);
  const timelineStart = Date.parse(scenario.timelineStart);
  const replayTime = replayEvents[replayIndex] ?? timelineStart;

  const activeIssues = useMemo(
    () => scenario.issues.filter((issue) => Date.parse(issue.createdAt) <= replayTime),
    [replayTime, scenario],
  );
  const activeIssueIdsKey = activeIssues.map((issue) => issue.id).join("|");

  const baseProjectedOrders = useMemo(
    () =>
      scenario.orders
        .map((order) =>
          adjustOrderForApprovals(
            order,
            scenario.issues,
            releaseApprovals,
            replayTime,
          ),
        )
        .map((order) => projectOrderAtTime(order, replayTime))
        .filter((order): order is Order => order !== null),
    [releaseApprovals, replayTime, scenario],
  );

  const issueLifecycles = useMemo(
    () =>
      Object.fromEntries(
        activeIssues.map((issue) => [
          issue.id,
          lifecycleForIssue(
            issue,
            replayTime,
            ticketRecords[issue.id],
            releaseApprovals[issue.id],
          ),
        ]),
      ) as Record<string, IssueLifecycle>,
    [activeIssues, releaseApprovals, replayTime, ticketRecords],
  );

  const unresolvedIssues = useMemo(
    () =>
      activeIssues.filter(
        (issue) =>
          issueLifecycles[issue.id]?.blocksOperations ||
          (ticketRecords[issue.id]?.status ?? "new") !== "resolved",
      ),
    [activeIssues, issueLifecycles, ticketRecords],
  );

  const blockingIssues = useMemo(
    () =>
      activeIssues.filter(
        (issue) => issueLifecycles[issue.id]?.blocksOperations,
      ),
    [activeIssues, issueLifecycles],
  );

  const projectedOrders = useMemo(
    () =>
      baseProjectedOrders.map((order) => {
        const correctedConflict = activeIssues.find(
          (issue) =>
            issue.effect === "assignment_conflict" &&
            Boolean(conflictResolutions[issue.id]) &&
            issue.affectedOrderIds.includes(order.orderId),
        );
        if (
          correctedConflict &&
          conflictResolutions[correctedConflict.id] !== order.orderId
        ) {
          return {
            ...order,
            status: "cancelled",
            preflightState: null,
            preflightChecks: [],
          };
        }

        const gates = blockingIssues.filter(
          (issue) =>
            (issue.affectedOrderIds.includes(order.orderId) ||
              (issue.effect !== "order_readiness_hold" &&
                issue.affectedDroneIds.includes(order.droneId))) &&
            Date.parse(issue.createdAt) <= Date.parse(order.launchAt),
        );
        if (
          !gates.length ||
          order.status === "cancelled"
        ) {
          return order;
        }

        const checks = [...order.preflightChecks];
        for (const issue of gates) {
          const label =
            issue.effect === "site_weather_hold"
              ? "Weather release"
              : issue.effect === "aircraft_ground"
                ? "Aircraft grounding"
                : issue.effect === "aircraft_restrict"
                  ? "Aircraft restriction"
                  : issue.effect === "assignment_conflict"
                    ? "Assignment conflict"
                    : "Merchant readiness";
          if (!checks.some((check) => check.label === label)) {
            checks.push({
              label,
              state: "blocked",
              detail: issueLifecycles[issue.id].label,
            });
          }
        }

        const hasGround = gates.some(
          (issue) => issue.effect === "aircraft_ground",
        );
        const hasWeather = gates.some(
          (issue) => issue.effect === "site_weather_hold",
        );
        return {
          ...order,
          status: "preflight",
          preflightState: hasGround
            ? "POLICY_GROUND_REQUIRED"
            : hasWeather
              ? "POLICY_HOLD_REQUIRED"
              : "CHECK_INCOMPLETE",
          preflightChecks: checks,
        };
      }),
    [
      activeIssues,
      baseProjectedOrders,
      blockingIssues,
      conflictResolutions,
      issueLifecycles,
    ],
  );

  const projectedDrones = useMemo(
    () =>
      scenario.drones.map((drone) => {
        const assignments = projectedOrders.filter((order) => order.droneId === drone.droneId);
        const active = assignments.filter((order) => order.status === "in_flight");
        const upcoming = assignments
          .filter((order) => order.status === "preflight" && order.minutesToLaunch <= 30)
          .sort((a, b) => Date.parse(a.launchAt) - Date.parse(b.launchAt));
        const chosen = active[0] ?? upcoming[0] ?? null;
        const droneGates = blockingIssues.filter((issue) =>
          issue.affectedDroneIds.includes(drone.droneId),
        );
        const groundGate = droneGates.find(
          (issue) => issue.effect === "aircraft_ground",
        );
        const weatherGate = droneGates.find(
          (issue) => issue.effect === "site_weather_hold",
        );
        const restrictGate = droneGates.find(
          (issue) =>
            issue.effect === "aircraft_restrict" ||
            issue.effect === "assignment_conflict",
        );
        const safetyLocked = Boolean(groundGate || weatherGate || restrictGate);
        const hasConflict = active.length > 1 || upcoming.length > 1;

        let status = drone.status;
        let activity = drone.activity;
        if (groundGate && active.length) {
          status = "review";
          activity = `In flight · landing required · ${issueLifecycles[groundGate.id].label}`;
        } else if (groundGate) {
          status = "grounded";
          activity = issueLifecycles[groundGate.id].label;
        } else if (weatherGate && active.length) {
          status = "in_flight";
          activity = "In flight · weather hold blocks new departures";
        } else if (weatherGate) {
          status = "grounded";
          activity = `Weather hold · ${issueLifecycles[weatherGate.id].label}`;
        } else if (restrictGate) {
          status = "review";
          activity = issueLifecycles[restrictGate.id].label;
        } else if (!safetyLocked) {
          if (hasConflict) {
            status = "conflict";
            activity = `${Math.max(active.length, upcoming.length)} overlapping assignments`;
          } else if (active.length) {
            status = "in_flight";
            activity = `In flight · ${active[0].zone}`;
          } else if (upcoming.length) {
            status = "preflight";
            activity = `Preflight · departs in ${upcoming[0].minutesToLaunch}m`;
          } else {
            status = "idle";
            activity = "Idle · available for planning";
          }
        }

        const telemetryVisible =
          chosen?.flightId === drone.flightId &&
          drone.lastTelemetryAt !== null &&
          Date.parse(drone.lastTelemetryAt) <= replayTime;

        return {
          ...drone,
          status,
          activity,
          flightId: chosen?.flightId ?? (safetyLocked ? drone.flightId : null),
          orderId: chosen?.orderId ?? (safetyLocked ? drone.orderId : null),
          batteryLevel: telemetryVisible ? drone.batteryLevel : null,
          batteryTemp: telemetryVisible ? drone.batteryTemp : null,
          gpsHdop: telemetryVisible ? drone.gpsHdop : null,
          phase: telemetryVisible ? drone.phase : null,
          lastTelemetryAt: telemetryVisible ? drone.lastTelemetryAt : null,
          activeFlightCount: active.length,
          upcomingFlightCount: upcoming.length,
          assignmentConflict: drone.assignmentConflict || hasConflict,
        };
      }),
    [blockingIssues, issueLifecycles, projectedOrders, replayTime, scenario],
  );

  const selectedDrone =
    projectedDrones.find((drone) => drone.droneId === selectedDroneId) ?? null;
  const selectedOrder =
    projectedOrders.find((order) => order.orderId === selectedOrderId) ?? null;
  const selectedIssue =
    activeIssues.find((issue) => issue.id === selectedIssueId) ??
    activeIssues[0] ??
    null;
  const toastIssue =
    scenario.issues.find((issue) => issue.id === toastIssueId) ?? null;
  const replayProgress =
    (replayIndex / Math.max(1, replayEvents.length - 1)) * 100;

  useEffect(() => {
    if (
      activeIssues.length &&
      !activeIssues.some((issue) => issue.id === selectedIssueId)
    ) {
      setSelectedIssueId(activeIssues[0].id);
    } else if (!activeIssues.length && selectedIssueId !== null) {
      setSelectedIssueId(null);
    }
  }, [activeIssues, selectedIssueId]);

  useEffect(() => {
    if (!isPlaying || replayIndex >= replayEvents.length - 1) return;
    const interval = window.setInterval(() => {
      setReplayIndex((current) => {
        const next = Math.min(
          replayEvents.length - 1,
          current + replaySpeed,
        );
        if (next >= replayEvents.length - 1) setIsPlaying(false);
        return next;
      });
    }, REPLAY_TICK_MS);
    return () => window.clearInterval(interval);
  }, [isPlaying, replayIndex, replaySpeed]);

  useEffect(() => {
    const previous = previousReplayTime.current;
    if (replayTime > previous) {
      const crossed = scenario.issues.filter((issue) => {
        const eventTime = Date.parse(issue.createdAt);
        return (
          eventTime > previous &&
          eventTime <= replayTime &&
          !notifiedIssueIds.current.has(issue.id)
        );
      });
      if (crossed.length) {
        crossed.forEach((issue) => notifiedIssueIds.current.add(issue.id));
        crossed.sort(
          (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
        );
        setIssueQueue((current) => [...current, ...crossed.map((issue) => issue.id)]);
      }
    }
    previousReplayTime.current = replayTime;
  }, [replayTime, scenario]);

  useEffect(() => {
    if (toastIssueId || !issueQueue.length) return;
    setToastIssueId(issueQueue[0]);
    setIssueQueue((current) => current.slice(1));
  }, [issueQueue, toastIssueId]);

  useEffect(() => {
    if (!toastIssueId) return;
    const timeout = window.setTimeout(() => setToastIssueId(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toastIssueId]);

  useEffect(() => {
    for (const issue of activeIssues) {
      if (recommendationRequests.current.has(issue.id)) continue;
      void refreshRecommendation(issue);
    }
  }, [activeIssueIdsKey]);

  useEffect(() => {
    try {
      // Workflow state belongs to this page session. Clear values written by
      // earlier versions so a refresh never revives archived issues or chats.
      window.localStorage.removeItem(ISSUE_TICKETS_KEY);
      window.localStorage.removeItem(ISSUE_MESSAGES_KEY);
      window.localStorage.removeItem(RELEASE_APPROVALS_KEY);
      window.localStorage.removeItem(CONFLICT_RESOLUTIONS_KEY);
      window.localStorage.removeItem(SIMULATION_RUN_KEY);
    } finally {
      setTicketRecords({});
      setMessagesByIssue({});
      setReleaseApprovals({});
      setConflictResolutions({});
      setWorkflowLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!workflowLoaded) return;
    setTicketRecords((current) => {
      const next = { ...current };
      let changed = false;
      for (const issue of activeIssues) {
        if (next[issue.id]) continue;
        next[issue.id] = {
          issueId: issue.id,
          scenarioId: scenario.id,
          status: "new",
          owner: "Unassigned",
          createdAt: issue.createdAt,
          updatedAt: issue.createdAt,
          resolvedAt: null,
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [activeIssueIdsKey, activeIssues, scenario.id, workflowLoaded]);

  useEffect(() => {
    if (!workflowLoaded) return;
    const notices: OperationalNotice[] = [];
    for (const issue of activeIssues) {
      const lifecycle = issueLifecycles[issue.id];
      if (!lifecycle) continue;
      const previous = previousLifecycleStates.current.get(issue.id);
      previousLifecycleStates.current.set(issue.id, lifecycle.state);
      if (previous === lifecycle.state) continue;

      if (lifecycle.state === "auto_cleared") {
        const now = issue.recoveryAt ?? new Date(replayTime).toISOString();
        const remainingBlocker = blockingIssues.find(
          (candidate) =>
            candidate.id !== issue.id &&
            candidate.affectedOrderIds.some((orderId) =>
              issue.affectedOrderIds.includes(orderId),
            ),
        );
        notices.push({
          id: `auto-clear:${issue.id}:${now}`,
          issueId: issue.id,
          title: issue.recoveryLabel ?? "Condition cleared",
          detail: remainingBlocker
            ? `Readiness hold cleared. Still held: ${remainingBlocker.title}.`
            : "The automatic hold was cleared from the current preflight state.",
        });
      } else if (lifecycle.state === "ready_for_release") {
        const now = issue.recoveryAt ?? new Date(replayTime).toISOString();
        setTicketRecords((current) => ({
          ...current,
          [issue.id]: {
            issueId: issue.id,
            scenarioId: scenario.id,
            status: "waiting",
            owner: "You",
            createdAt: current[issue.id]?.createdAt ?? issue.createdAt,
            updatedAt: now,
            resolvedAt: null,
          },
        }));
        notices.push({
          id: `release-ready:${issue.id}:${now}`,
          issueId: issue.id,
          title: issue.recoveryLabel ?? "Condition returned within limits",
          detail: "Operations remain held until an operator approves release.",
        });
      }
    }
    if (notices.length) {
      setOperationalNoticeQueue((current) => [...current, ...notices]);
    }
  }, [
    activeIssues,
    blockingIssues,
    issueLifecycles,
    replayTime,
    scenario.id,
    workflowLoaded,
  ]);

  useEffect(() => {
    if (operationalNotice || !operationalNoticeQueue.length) return;
    setOperationalNotice(operationalNoticeQueue[0]);
    setOperationalNoticeQueue((current) => current.slice(1));
  }, [operationalNotice, operationalNoticeQueue]);

  useEffect(() => {
    if (!operationalNotice) return;
    const timeout = window.setTimeout(() => setOperationalNotice(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [operationalNotice]);

  const filteredDrones = useMemo(() => {
    const query = fleetQuery.trim().toLowerCase();
    return projectedDrones.filter((drone) => {
      const matchesQuery =
        !query ||
        [drone.droneId, drone.siteLabel, drone.activity, drone.flightId ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesFilter =
        fleetFilter === "all" ||
        (fleetFilter === "attention"
          ? ["grounded", "maintenance", "review", "conflict"].includes(drone.status)
          : drone.status === fleetFilter);
      return matchesQuery && matchesFilter;
    });
  }, [fleetFilter, fleetQuery, projectedDrones]);

  const filteredOrders = useMemo(() => {
    const query = orderQuery.trim().toLowerCase();
    return projectedOrders.filter((order) => {
      const matchesQuery =
        !query ||
        [order.orderId, order.flightId, order.droneId, order.merchant, order.zone]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesFilter =
        orderFilter === "all" ||
        (orderFilter === "attention"
          ? ["CHECK_INCOMPLETE", "POLICY_HOLD_REQUIRED", "POLICY_GROUND_REQUIRED", "OPERATOR_REVIEW_REQUIRED"].includes(order.preflightState ?? "")
          : order.status === orderFilter);
      return matchesQuery && matchesFilter;
    });
  }, [orderFilter, orderQuery, projectedOrders]);

  function resetReplayState(nextScenario: Scenario) {
    window.localStorage.removeItem(ISSUE_TICKETS_KEY);
    window.localStorage.removeItem(ISSUE_MESSAGES_KEY);
    window.localStorage.removeItem(RELEASE_APPROVALS_KEY);
    window.localStorage.removeItem(CONFLICT_RESOLUTIONS_KEY);
    window.localStorage.setItem(SIMULATION_RUN_KEY, nextScenario.runId);
    setTicketRecords({});
    setMessagesByIssue({});
    setReleaseApprovals({});
    setConflictResolutions({});
    setRecommendations({});
    setRecommendationLoading({});
    recommendationRequests.current.clear();
    setOperationalNoticeQueue([]);
    setOperationalNotice(null);
    previousLifecycleStates.current = new Map();
    setReplayIndex(0);
    const nextTimelineStart = Date.parse(nextScenario.timelineStart);
    previousReplayTime.current = nextTimelineStart;
    notifiedIssueIds.current = new Set(
      nextScenario.issues
        .filter((issue) => Date.parse(issue.createdAt) <= nextTimelineStart)
        .map((issue) => issue.id),
    );
    setIssueQueue([]);
    setToastIssueId(null);
    setSelectedIssueId(
      nextScenario.issues.find(
        (issue) => Date.parse(issue.createdAt) <= nextTimelineStart,
      )?.id ??
        null,
    );
    setSelectedDroneId(null);
    setSelectedOrderId(null);
    setIsPlaying(true);
  }

  function restartReplay() {
    resetReplayState(scenario);
  }

  function generateNewSimulation() {
    const nextScenario = generateSimulation(createSimulationSeed()) as Scenario;
    setScenario(nextScenario);
    resetReplayState(nextScenario);
    window.history.replaceState({}, "", window.location.pathname);
  }

  function seekReplay(nextIndex: number) {
    const nextTime = replayEvents[nextIndex] ?? timelineStart;
    setReplayIndex(nextIndex);
    previousReplayTime.current = nextTime;
    notifiedIssueIds.current = new Set(
      scenario.issues
        .filter((issue) => Date.parse(issue.createdAt) <= nextTime)
        .map((issue) => issue.id),
    );
    setIssueQueue([]);
    setToastIssueId(null);
  }

  function toggleReplay() {
    if (replayIndex >= replayEvents.length - 1) {
      restartReplay();
      return;
    }
    setIsPlaying((current) => !current);
  }

  async function refreshRecommendation(issue: Issue, force = false) {
    if (!force && recommendationRequests.current.has(issue.id)) return;
    recommendationRequests.current.add(issue.id);
    setRecommendations((current) => ({
      ...current,
      [issue.id]: current[issue.id] ?? buildImmediateRecommendation(issue),
    }));
    setRecommendationLoading((current) => ({ ...current, [issue.id]: true }));
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issue }),
      });
      if (!response.ok) throw new Error("Recommendation request failed");
      const result = (await response.json()) as RecommendationResult;
      setRecommendations((current) => ({ ...current, [issue.id]: result }));
    } catch {
      setRecommendations((current) => ({
        ...current,
        [issue.id]: current[issue.id] ?? buildImmediateRecommendation(issue),
      }));
    } finally {
      setRecommendationLoading((current) => ({ ...current, [issue.id]: false }));
    }
  }

  async function updateTicketStatus(issueId: string, status: TicketStatus) {
    const issue = activeIssues.find((candidate) => candidate.id === issueId);
    const lifecycle = issueLifecycles[issueId];
    const withdrawingRelease =
      issue?.clearanceMode === "human_release" &&
      Boolean(releaseApprovals[issueId]) &&
      status !== "resolved";
    const nextStatus: TicketStatus = withdrawingRelease ? "waiting" : status;
    if (
      status === "resolved" &&
      issue?.clearanceMode === "human_release" &&
      lifecycle?.state !== "released"
    ) {
      return;
    }
    if (
      status === "resolved" &&
      issue?.clearanceMode === "automatic" &&
      lifecycle?.state !== "auto_cleared"
    ) {
      return;
    }
    if (
      status === "resolved" &&
      issue?.effect === "assignment_conflict" &&
      !conflictResolutions[issueId]
    ) {
      return;
    }
    const now = new Date().toISOString();
    const previous = ticketRecords[issueId];

    if (withdrawingRelease && issue) {
      setReleaseApprovals((current) => {
        const next = { ...current };
        delete next[issueId];
        return next;
      });
      setOperationalNoticeQueue((current) => [
        ...current,
        {
          id: `release-withdrawn:${issueId}:${now}`,
          issueId,
          title: `Release withdrawn · ${issue.entity}`,
          detail:
            "The operational hold is active again and waiting for approval. Recovery evidence remains available.",
        },
      ]);
    }

    const updated: TicketRecord = {
      issueId,
      scenarioId: scenario.id,
      status: nextStatus,
      owner: nextStatus === "new" ? previous?.owner ?? "Unassigned" : "You",
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      resolvedAt: nextStatus === "resolved" ? now : null,
    };
    setTicketRecords((current) => ({ ...current, [issueId]: updated }));
  }

  async function approveOperationalRelease(issueId: string) {
    const issue = activeIssues.find((candidate) => candidate.id === issueId);
    if (!issue || issueLifecycles[issueId]?.state !== "ready_for_release") return;
    const approvedAt = new Date(replayTime).toISOString();
    setReleaseApprovals((current) => ({ ...current, [issueId]: approvedAt }));
    setTicketRecords((current) => ({
      ...current,
      [issueId]: {
        issueId,
        scenarioId: scenario.id,
        status: "resolved",
        owner: "You",
        createdAt: current[issueId]?.createdAt ?? issue.createdAt,
        updatedAt: approvedAt,
        resolvedAt: approvedAt,
      },
    }));
    setOperationalNoticeQueue((current) => [
      ...current,
      {
        id: `release-approved:${issueId}:${approvedAt}`,
        issueId,
        title: `Release approved · ${issue.entity}`,
        detail: "This hold is cleared. All remaining preflight checks still apply.",
      },
    ]);
  }

  async function resolveAssignmentConflict(
    issueId: string,
    retainedOrderId: string,
  ) {
    const issue = activeIssues.find((candidate) => candidate.id === issueId);
    if (
      !issue ||
      issue.effect !== "assignment_conflict" ||
      !issue.affectedOrderIds.includes(retainedOrderId)
    ) {
      return;
    }
    const resolvedAt = new Date(replayTime).toISOString();
    setConflictResolutions((current) => ({
      ...current,
      [issueId]: retainedOrderId,
    }));
    setTicketRecords((current) => ({
      ...current,
      [issueId]: {
        issueId,
        scenarioId: scenario.id,
        status: "resolved",
        owner: "You",
        createdAt: current[issueId]?.createdAt ?? issue.createdAt,
        updatedAt: resolvedAt,
        resolvedAt,
      },
    }));
    setOperationalNoticeQueue((current) => [
      ...current,
      {
        id: `assignment-cleared:${issueId}:${resolvedAt}`,
        issueId,
        title: `Assignment conflict cleared · ${issue.entity}`,
        detail: `${retainedOrderId} was retained. The conflicting assignment was removed.`,
      },
    ]);
  }

  async function sendIssueMessage(
    issueId: string,
    channel: string,
    body: string,
  ) {
    const message: ChatMessage = {
      id: Date.now(),
      issueId,
      channel,
      senderName: "You",
      senderRole: "operator",
      body,
      createdAt: new Date().toISOString(),
    };
    setMessagesByIssue((current) => ({
      ...current,
      [issueId]: [...(current[issueId] ?? []), message],
    }));
    await updateTicketStatus(issueId, "waiting");
  }

  function openIssues(issueId?: string) {
    setView("issues");
    setSelectedIssueId(
      issueId ?? unresolvedIssues[0]?.id ?? activeIssues[0]?.id ?? null,
    );
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-header">
          <div className="brand-lockup">
            <span className="brand-word">ZIPLINE</span>
            <span className="brand-product">Operations</span>
          </div>
          <span className="brand-mark" aria-hidden="true">Z</span>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
        </div>

        <div className="product-mode">
          <span className="live-pulse" />
          Live operations
        </div>

        <nav className="primary-nav">
          <button
            className={view === "fleet" ? "active" : ""}
            onClick={() => setView("fleet")}
            title="Fleet"
          >
            <Gauge size={19} />
            <span className="nav-label">Fleet</span>
          </button>
          <button
            className={view === "orders" ? "active" : ""}
            onClick={() => setView("orders")}
            title="Orders"
          >
            <PackageCheck size={19} />
            <span className="nav-label">Orders</span>
          </button>
          <button
            className={view === "issues" ? "active" : ""}
            onClick={() => openIssues()}
            title="Issues"
          >
            <ShieldAlert size={19} />
            <span className="nav-label">Issues</span>
            <span className="nav-badge">{unresolvedIssues.length}</span>
          </button>
          <span className="nav-section-label">ANALYSIS</span>
          <button
            className={view === "history" ? "active" : ""}
            onClick={() => setView("history")}
            title="History"
          >
            <History size={19} />
            <span className="nav-label">History</span>
          </button>
        </nav>

      </aside>

      <main className="main-area">
        <header className={`topbar ${view === "history" ? "history-topbar" : ""}`}>
          <strong className="replay-title">
            {view === "history" ? "History" : "Replay"}
          </strong>

          {view !== "history" && (
            <>
              <button
                className="simulation-seed"
                type="button"
                title="Copy a reproducible simulation link"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `${window.location.origin}${window.location.pathname}?seed=${encodeURIComponent(scenario.seed)}`,
                  )
                }
              >
                Seed {scenario.seed}
              </button>
              <div className="replay-clock">
                <Clock3 size={16} />
                <div>
                  <span>{formatTime(new Date(replayTime).toISOString(), true)}</span>
                  <small>Replay clock</small>
                </div>
              </div>

              <button className="replay-action" onClick={toggleReplay}>
                {isPlaying ? (
                  <Pause size={15} fill="currentColor" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
                {isPlaying
                  ? "Pause"
                  : replayIndex >= replayEvents.length - 1
                    ? "Replay again"
                    : "Resume"}
              </button>
              <button className="replay-action" onClick={generateNewSimulation}>
                <RefreshCw size={15} />
                New simulation
              </button>
            </>
          )}

          <button
            className="notification-button"
            aria-label={`${unresolvedIssues.length} active issues`}
            onClick={() => openIssues()}
          >
            <Bell size={19} />
            <span>{unresolvedIssues.length}</span>
          </button>
        </header>

        {view !== "history" && (
          <section className="timeline-control" aria-label="Replay timeline">
            <button
              className="timeline-reset"
              onClick={restartReplay}
              aria-label="Restart replay"
              title="Restart replay"
            >
              <RotateCcw size={15} />
            </button>
            <div className="timeline-scrubber">
              <input
                type="range"
                min={0}
                max={replayEvents.length - 1}
                step={1}
                value={replayIndex}
                onChange={(event) => seekReplay(Number(event.target.value))}
                aria-label="Replay position"
                style={{ "--replay-progress": `${replayProgress}%` } as React.CSSProperties}
              />
              <div>
                <span>{formatTime(scenario.timelineStart, true)}</span>
                <span>{formatTime(scenario.timelineEnd, true)}</span>
              </div>
            </div>
            <label className="speed-control">
              <span>Speed</span>
              <select
                value={replaySpeed}
                onChange={(event) => setReplaySpeed(Number(event.target.value))}
              >
                <option value={1}>1×</option>
                <option value={3}>3×</option>
                <option value={10}>10×</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </section>
        )}

        {view === "fleet" && (
          <FleetView
            scenario={scenario}
            drones={filteredDrones}
            allDrones={projectedDrones}
            replayTime={replayTime}
            query={fleetQuery}
            setQuery={setFleetQuery}
            filter={fleetFilter}
            setFilter={setFleetFilter}
            onSelect={setSelectedDroneId}
          />
        )}

        {view === "orders" && (
          <OrdersView
            orders={filteredOrders}
            allOrders={projectedOrders}
            query={orderQuery}
            setQuery={setOrderQuery}
            filter={orderFilter}
            setFilter={setOrderFilter}
            onSelect={setSelectedOrderId}
          />
        )}

        {view === "issues" &&
          (selectedIssue ? (
            <IssuesView
              issues={activeIssues}
              orders={projectedOrders}
              selectedIssue={selectedIssue}
              onSelect={setSelectedIssueId}
              recommendation={recommendations[selectedIssue.id]}
              onRefresh={() => refreshRecommendation(selectedIssue, true)}
              loading={Boolean(recommendationLoading[selectedIssue.id])}
              tickets={ticketRecords}
              messages={messagesByIssue}
              workflowBusy={workflowBusy}
              lifecycles={issueLifecycles}
              onStatusChange={updateTicketStatus}
              onSendMessage={sendIssueMessage}
              onApproveRelease={approveOperationalRelease}
              onResolveConflict={resolveAssignmentConflict}
            />
          ) : (
            <EmptyIssues />
          ))}

        <div
          className={`history-view-host ${view === "history" ? "active" : ""}`}
        >
          <HistoryWorkspace />
        </div>
      </main>

      {selectedDrone && (
        <DroneDrawer drone={selectedDrone} onClose={() => setSelectedDroneId(null)} />
      )}
      {selectedOrder && (
        <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrderId(null)} />
      )}
      {operationalNotice && (
        <button
          className="live-toast recovery-toast"
          onClick={() => openIssues(operationalNotice.issueId)}
        >
          <span className="toast-icon">
            <CheckCircle2 size={17} />
          </span>
          <span>
            <strong>{operationalNotice.title}</strong>
            <small>{operationalNotice.detail}</small>
          </span>
          <ArrowRight size={17} />
        </button>
      )}
      {toastIssue && !operationalNotice && (
        <button className="live-toast" onClick={() => openIssues(toastIssue.id)}>
          <span className="toast-icon">
            <Bell size={17} />
          </span>
          <span>
            <strong>{toastIssue.priority} · {toastIssue.title}</strong>
            <small>Detected at {formatTime(toastIssue.createdAt)}</small>
          </span>
          <ArrowRight size={17} />
        </button>
      )}
    </div>
  );
}

function FleetView({
  scenario,
  drones,
  allDrones,
  replayTime,
  query,
  setQuery,
  filter,
  setFilter,
  onSelect,
}: {
  scenario: Scenario;
  drones: Drone[];
  allDrones: Drone[];
  replayTime: number;
  query: string;
  setQuery: (value: string) => void;
  filter: string;
  setFilter: (value: string) => void;
  onSelect: (droneId: string) => void;
}) {
  const airborne = allDrones.filter((drone) => drone.status === "in_flight").length;
  const preflight = allDrones.filter((drone) => drone.status === "preflight").length;
  const grounded = allDrones.filter((drone) =>
    ["grounded", "maintenance"].includes(drone.status),
  ).length;
  const conflicts = allDrones.filter(
    (drone) => drone.status === "conflict" || drone.assignmentConflict,
  ).length;
  const currentWeather = [
    ...scenario.weather
      .filter((reading) => Date.parse(reading.observedAt) <= replayTime)
      .reduce((latest, reading) => {
        const current = latest.get(reading.site);
        if (
          !current ||
          Date.parse(reading.observedAt) > Date.parse(current.observedAt)
        ) {
          latest.set(reading.site, reading);
        }
        return latest;
      }, new Map<string, Weather>())
      .values(),
  ];

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>Fleet status</h1>
        </div>
        <div className="heading-status">
          <CircleDot size={16} />
          {allDrones.length} aircraft
        </div>
      </div>

      <div className="metric-grid">
        <Metric label="Airborne" value={airborne} tone="violet" />
        <Metric label="Preflight" value={preflight} />
        <Metric label="Grounded" value={grounded} tone="critical" />
        <Metric label="Assignment conflicts" value={conflicts} />
      </div>

      {currentWeather.length > 0 && (
        <div className="weather-strip">
          {currentWeather.map((weather) => (
            <div
              className={`weather-card weather-${weather.policyState}`}
              key={`${weather.site}-${weather.observedAt}`}
            >
              <div className="weather-title">
                <CloudSun size={18} />
                <strong>{weather.siteLabel}</strong>
                <span>{weather.policyState}</span>
              </div>
              <div className="weather-values">
                <span>
                  <Wind size={14} />
                  {weather.wind} <small>kph</small>
                </span>
                <span>
                  Gust {weather.gust} <small>kph</small>
                </span>
                <span>
                  Vis {weather.visibility} <small>km</small>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel table-panel">
        <div className="panel-toolbar">
          <div>
            <h2>Fleet status</h2>
            <span>{drones.length} of 24 aircraft</span>
          </div>
          <div className="toolbar-actions">
            <label className="search-control">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search drone, flight, site"
                aria-label="Search fleet"
              />
            </label>
            <label className="filter-control">
              <ListFilter size={16} />
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filter fleet"
              >
                <option value="all">All states</option>
                <option value="in_flight">In flight</option>
                <option value="preflight">Preflight</option>
                <option value="attention">Needs attention</option>
                <option value="idle">Idle</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Aircraft</th>
                <th>Status</th>
                <th>Current activity</th>
                <th>Live battery</th>
                <th>Daily health</th>
                <th>Spread</th>
                <th>Vibration</th>
                <th>Last signal</th>
              </tr>
            </thead>
            <tbody>
              {drones.map((drone) => (
                <tr key={drone.droneId} onClick={() => onSelect(drone.droneId)}>
                  <td>
                    <button className="row-primary" onClick={() => onSelect(drone.droneId)}>
                      {drone.droneId}
                      <small>
                        <MapPin size={12} />
                        {drone.siteLabel}
                      </small>
                    </button>
                  </td>
                  <td><StatusChip status={drone.status} /></td>
                  <td>
                    <span className="activity-cell">
                      {drone.activity}
                      {drone.flightId && <small>{drone.flightId}</small>}
                    </span>
                  </td>
                  <td>
                    {drone.batteryLevel === null ? (
                      <span className="no-data">—</span>
                    ) : (
                      <BatteryGauge value={drone.batteryLevel} />
                    )}
                  </td>
                  <td>
                    <strong>{drone.batteryCapacity}%</strong>
                    <small className="cell-caption">capacity</small>
                  </td>
                  <td>{drone.cellSpread} mV</td>
                  <td>{drone.vibration} mm/s</td>
                  <td>
                    <span className="last-signal">
                      {formatTime(drone.lastTelemetryAt)}
                      <small>{drone.phase ? `${drone.phase} phase` : "daily snapshot"}</small>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OrdersView({
  orders,
  allOrders,
  query,
  setQuery,
  filter,
  setFilter,
  onSelect,
}: {
  orders: Order[];
  allOrders: Order[];
  query: string;
  setQuery: (value: string) => void;
  filter: string;
  setFilter: (value: string) => void;
  onSelect: (orderId: string) => void;
}) {
  const preflightCount = allOrders.filter((order) => order.status === "preflight").length;
  const waitingCount = allOrders.filter(
    (order) => order.readinessStatus === "awaiting_event",
  ).length;
  const inFlightCount = allOrders.filter((order) => order.status === "in_flight").length;

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>Order status</h1>
        </div>
        <div className="heading-status">
          <PackageCheck size={16} />
          Today&apos;s operating window
        </div>
      </div>

      <div className="metric-grid metric-grid-three">
        <Metric label="In flight" value={inFlightCount} tone="violet" />
        <Metric label="Preflight" value={preflightCount} />
        <Metric label="Awaiting readiness" value={waitingCount} tone="critical" />
      </div>

      <div className="panel table-panel">
        <div className="panel-toolbar">
          <div>
            <h2>Active and recent orders</h2>
            <span>{orders.length} records shown</span>
          </div>
          <div className="toolbar-actions">
            <label className="search-control">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search order, merchant, flight"
                aria-label="Search orders"
              />
            </label>
            <label className="filter-control">
              <ListFilter size={16} />
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filter orders"
              >
                <option value="all">All states</option>
                <option value="preflight">Preflight</option>
                <option value="in_flight">In flight</option>
                <option value="attention">Needs attention</option>
                <option value="delivered">Delivered</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Merchant</th>
                <th>Readiness</th>
                <th>Flight / aircraft</th>
                <th>Service</th>
                <th>Launch</th>
                <th>Preflight</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderId} onClick={() => onSelect(order.orderId)}>
                  <td>
                    <button className="row-primary" onClick={() => onSelect(order.orderId)}>
                      {order.orderId}
                      <small>{order.zone}</small>
                    </button>
                  </td>
                  <td><StatusChip status={order.status} /></td>
                  <td>
                    <span className="activity-cell">
                      {order.merchant}
                      <small>{displayService(order.merchantCategory)}</small>
                    </span>
                  </td>
                  <td>
                    <span className={`readiness readiness-${order.readinessStatus}`}>
                      {order.readinessLabel}
                    </span>
                  </td>
                  <td>
                    <span className="activity-cell">
                      {order.flightId}
                      <small>{order.droneId}</small>
                    </span>
                  </td>
                  <td>
                    <span className={`service service-${order.serviceLevel}`}>
                      {displayService(order.serviceLevel)}
                    </span>
                  </td>
                  <td>
                    <span className="activity-cell">
                      {formatTime(order.launchAt)}
                      {order.status === "preflight" && (
                        <small>{order.minutesToLaunch}m from replay time</small>
                      )}
                    </span>
                  </td>
                  <td>
                    {order.preflightState ? (
                      <span className={`preflight-state preflight-${order.preflightState.toLowerCase()}`}>
                        {preflightLabels[order.preflightState]}
                      </span>
                    ) : (
                      <span className="no-data">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EmptyIssues() {
  return (
    <div className="page-content issues-page">
      <div className="page-heading">
        <h1>Issues</h1>
      </div>
      <div className="panel empty-issues">
        <ShieldAlert size={22} />
        <strong>No issues</strong>
      </div>
    </div>
  );
}

function IssuesView({
  issues,
  orders,
  selectedIssue,
  onSelect,
  recommendation,
  onRefresh,
  loading,
  tickets,
  messages,
  workflowBusy,
  lifecycles,
  onStatusChange,
  onSendMessage,
  onApproveRelease,
  onResolveConflict,
}: {
  issues: Issue[];
  orders: Order[];
  selectedIssue: Issue;
  onSelect: (issueId: string) => void;
  recommendation?: RecommendationResult;
  onRefresh: () => void;
  loading: boolean;
  tickets: Record<string, TicketRecord>;
  messages: Record<string, ChatMessage[]>;
  workflowBusy: Record<string, boolean>;
  lifecycles: Record<string, IssueLifecycle>;
  onStatusChange: (issueId: string, status: TicketStatus) => Promise<void>;
  onSendMessage: (
    issueId: string,
    channel: string,
    body: string,
  ) => Promise<void>;
  onApproveRelease: (issueId: string) => Promise<void>;
  onResolveConflict: (
    issueId: string,
    retainedOrderId: string,
  ) => Promise<void>;
}) {
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [chatOpen, setChatOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [recommendationOpen, setRecommendationOpen] = useState(false);
  const [openReference, setOpenReference] = useState<OpenReference | null>(null);
  const referenceTargetRef = useRef<HTMLElement | null>(null);
  const [recipientByIssue, setRecipientByIssue] = useState<Record<string, string>>(
    {},
  );
  const activeRecommendation =
    recommendation ?? buildImmediateRecommendation(selectedIssue);
  const selectedLifecycle = lifecycles[selectedIssue.id];
  const visibleStatus = (issue: Issue): TicketStatus => {
    const storedStatus = tickets[issue.id]?.status ?? "new";
    const lifecycle = lifecycles[issue.id];
    if (storedStatus === "resolved" && lifecycle?.blocksOperations) {
      return lifecycle.state === "ready_for_release" ? "waiting" : "new";
    }
    return storedStatus;
  };
  const selectedStatus = visibleStatus(selectedIssue);
  const selectedMessages = messages[selectedIssue.id] ?? [];
  const conflictingOrders = selectedIssue.affectedOrderIds
    .map((orderId) => orders.find((order) => order.orderId === orderId))
    .filter((order): order is Order => Boolean(order));
  const approvalPolicyIds = [
    ...new Set([
      ...selectedIssue.ruleIds,
      ...(selectedIssue.effect === "site_weather_hold"
        ? ["POL-WEATHER-REVIEW"]
        : []),
    ]),
  ].filter((ruleId) =>
    ["POL-WEATHER-HOLD", "POL-WEATHER-REVIEW", "POL-FLEET-GROUND", "POL-FLEET-RESTRICT"].includes(
      getPolicyReference(ruleId).policyId,
    ),
  );
  const availableEvidence = [
    ...selectedIssue.evidence,
    ...selectedIssue.recoveryEvidence,
    ...(activeRecommendation.evidence ?? []),
  ];
  const evidenceById = new Map(
    availableEvidence.map((item) => [item.id, item]),
  );
  const allEvidence = [
    ...issues.flatMap((issue) => [
      ...issue.evidence,
      ...issue.recoveryEvidence,
    ]),
    ...(activeRecommendation.evidence ?? []),
  ].filter(
    (item, index, source) =>
      source.findIndex((candidate) => candidate.id === item.id) === index,
  );
  const totalMessageCount = Object.values(messages).reduce(
    (total, thread) => total + thread.length,
    0,
  );
  const draft =
    drafts[selectedIssue.id] ??
    activeRecommendation.coordination.draftMessage;
  const recommendedRecipient: MessageRecipient = {
    channel: activeRecommendation.coordination.channel,
    name: activeRecommendation.coordination.contactName,
    role: activeRecommendation.coordination.contactRole,
  };
  const recipientOptions = [
    recommendedRecipient,
    ...MESSAGE_RECIPIENTS.filter(
      (recipient) => recipient.channel !== recommendedRecipient.channel,
    ),
  ];
  const selectedRecipient =
    recipientOptions.find(
      (recipient) => recipient.channel === recipientByIssue[selectedIssue.id],
    ) ?? recommendedRecipient;
  const openCount = issues.filter(
    (issue) => visibleStatus(issue) !== "resolved",
  ).length;
  const waitingCount = issues.filter(
    (issue) => visibleStatus(issue) === "waiting",
  ).length;
  const blockingCount = issues.filter(
    (issue) => issue.launchBlocking && lifecycles[issue.id]?.blocksOperations,
  ).length;
  const columns: Array<{ status: TicketStatus; label: string }> = [
    { status: "new", label: "New" },
    { status: "in_progress", label: "In progress" },
    { status: "waiting", label: "Waiting" },
    { status: "resolved", label: "Resolved" },
  ];

  async function sendDraft() {
    const body = draft.trim();
    if (!body) return;
    setDrafts((current) => ({ ...current, [selectedIssue.id]: "" }));
    await onSendMessage(
      selectedIssue.id,
      selectedRecipient.channel,
      body,
    );
  }

  function openRecommendation(issueId: string) {
    onSelect(issueId);
    setRecommendationOpen(true);
  }

  function openIssueChat(issueId = selectedIssue.id) {
    onSelect(issueId);
    setChatOpen(true);
  }

  function closeIssueChat() {
    setChatOpen(false);
    setChatExpanded(false);
  }

  useEffect(() => {
    if (!openReference) return;
    const frame = window.requestAnimationFrame(() => {
      referenceTargetRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openReference]);

  return (
    <div className="page-content issues-page">
      <div className="page-heading">
        <div>
          <h1>Issues</h1>
        </div>
        <div className="issue-heading-metrics">
          <span><strong>{openCount}</strong> open</span>
          <span><strong>{waitingCount}</strong> waiting</span>
          <span className={blockingCount ? "critical" : ""}>
            <strong>{blockingCount}</strong> blocking
          </span>
        </div>
      </div>

      <div className="issue-workspace">
        <section className="kanban-shell" aria-label="Issue workflow board">
          <div className="kanban-board">
            {columns.map((column) => {
              const columnIssues = issues.filter(
                (issue) => visibleStatus(issue) === column.status,
              );
              return (
                <div
                  className={`kanban-column kanban-${column.status}`}
                  key={column.status}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (draggedIssueId) {
                      void onStatusChange(draggedIssueId, column.status);
                      setDraggedIssueId(null);
                    }
                  }}
                >
                  <div className="kanban-column-header">
                    <span className="column-dot" />
                    <div>
                      <strong>{column.label}</strong>
                    </div>
                    <b>{columnIssues.length}</b>
                  </div>
                  <div className="kanban-cards">
                    {columnIssues.map((issue) => {
                      const issueRecommendation =
                        recommendation && issue.id === selectedIssue.id
                          ? recommendation
                          : undefined;
                      return (
                        <button
                          className={`kanban-card ${
                            issue.id === selectedIssue.id ? "selected" : ""
                          }`}
                          key={issue.id}
                          onClick={() => openRecommendation(issue.id)}
                          draggable
                          onDragStart={() => setDraggedIssueId(issue.id)}
                          onDragEnd={() => setDraggedIssueId(null)}
                        >
                          <span className="kanban-card-top">
                            <PriorityChip priority={issue.priority} />
                            <small>{issue.category}</small>
                            {issue.launchBlocking && (
                              <span className="blocking-dot" title="Launch blocking" />
                            )}
                          </span>
                          <strong>{issue.title}</strong>
                          <span className="kanban-ai-preview">
                            <Bot size={13} />
                            {displayService(
                              issueRecommendation?.actionId ??
                            issue.defaultAction,
                            )}
                          </span>
                          <span className="kanban-card-footer">
                            <span>
                              <MessageSquare size={12} />
                              {messages[issue.id]?.length ?? 0}
                            </span>
                            <span>{formatTime(issue.createdAt)}</span>
                          </span>
                        </button>
                      );
                    })}
                    {!columnIssues.length && (
                      <div className="kanban-empty">Drop a ticket here</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {recommendationOpen && (
          <div
            className="recommendation-dialog-layer"
            role="dialog"
            aria-modal="true"
            aria-label={`Recommended action for ${selectedIssue.title}`}
          >
            <button
              className="recommendation-dialog-backdrop"
              type="button"
              onClick={() => setRecommendationOpen(false)}
              aria-label="Close recommendation"
            />
            <aside className="panel issue-detail ticket-inspector recommendation-dialog">
          <div className="issue-detail-header">
            <div>
              <div className="issue-detail-meta">
                <PriorityChip priority={selectedIssue.priority} />
                <span>{selectedIssue.category}</span>
                {selectedIssue.launchBlocking && (
                  <span className="blocking-chip">Launch blocking</span>
                )}
              </div>
              <h2>{selectedIssue.title}</h2>
              <p>{selectedIssue.summary}</p>
            </div>
            <div className="issue-detail-actions">
              <span className={`ticket-status-chip ticket-status-${selectedStatus}`}>
                {columns.find((column) => column.status === selectedStatus)?.label}
              </span>
              <button
                className="recommendation-dialog-close"
                type="button"
                onClick={() => setRecommendationOpen(false)}
                aria-label="Close recommendation"
              >
                <X size={19} />
              </button>
            </div>
          </div>

          {selectedLifecycle && selectedIssue.effect !== "advisory" && (
            <section
              className={`issue-lifecycle-card lifecycle-${selectedLifecycle.state}`}
            >
              <div className="issue-lifecycle-summary">
                <span>
                  {selectedLifecycle.state === "ready_for_release" ? (
                    <CheckCircle2 size={17} />
                  ) : (
                    <ShieldAlert size={17} />
                  )}
                </span>
                <div>
                  <strong>{selectedLifecycle.label}</strong>
                  <small>
                    {selectedLifecycle.state === "ready_for_release"
                      ? "Review the verification records below before releasing the operational hold."
                      : selectedLifecycle.state === "condition_active"
                        ? "The operational hold is enforced independently of the ticket status."
                        : selectedLifecycle.state === "auto_cleared"
                          ? "Source data cleared this condition automatically."
                          : "All remaining preflight checks still apply."}
                  </small>
                </div>
              </div>
              {selectedLifecycle.state === "ready_for_release" && (
                <div className="approval-review">
                  <div className="approval-review-heading">
                    <div>
                      <strong>Evidence for approval</strong>
                      <small>Simulation records · generated for this replay</small>
                    </div>
                    <span>{selectedIssue.recoveryEvidence.length} verified</span>
                  </div>

                  <div className="approval-evidence-list">
                    {selectedIssue.recoveryEvidence.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() =>
                          setOpenReference({ kind: "evidence", value: item })
                        }
                      >
                        <CheckCircle2 size={14} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.value}</small>
                          <em>
                            {item.dataset} · {formatTime(item.timestamp, true)}
                          </em>
                        </span>
                        <ArrowRight size={13} />
                      </button>
                    ))}
                  </div>

                  <div className="approval-policy-list">
                    {approvalPolicyIds.map((ruleId) => {
                        const policy = getPolicyReference(ruleId);
                        return (
                          <button
                            type="button"
                            key={ruleId}
                            onClick={() =>
                              setOpenReference({ kind: "policy", value: policy })
                            }
                          >
                            <ShieldAlert size={13} />
                            <span>
                              <strong>{policy.title}</strong>
                              <small>{policy.text}</small>
                            </span>
                          </button>
                        );
                      })}
                  </div>

                  <div className="approval-action">
                    <small>
                      Approval removes this hold only. Normal preflight checks still apply.
                    </small>
                    <button
                      type="button"
                      onClick={() => void onApproveRelease(selectedIssue.id)}
                    >
                      Approve release
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {selectedIssue.effect === "assignment_conflict" &&
            selectedLifecycle?.blocksOperations && (
              <section className="assignment-resolution">
                <div className="assignment-resolution-heading">
                  <div>
                    <strong>Choose the assignment to keep</strong>
                    <small>
                      Both orders claim {selectedIssue.entity}. Hover for full details.
                    </small>
                  </div>
                  <span>{conflictingOrders.length} orders</span>
                </div>
                <div className="assignment-order-list">
                  {conflictingOrders.map((order) => (
                    <button
                      className="assignment-order-card"
                      type="button"
                      key={order.orderId}
                      onClick={() =>
                        void onResolveConflict(selectedIssue.id, order.orderId)
                      }
                    >
                      <span className="assignment-order-topline">
                        <strong>{order.orderId}</strong>
                        <b>{displayService(order.serviceLevel)}</b>
                      </span>
                      <span className="assignment-order-merchant">
                        {order.merchant}
                        <small>{order.merchantCategory}</small>
                      </span>
                      <span className="assignment-order-facts">
                        <span>
                          <small>Flight</small>
                          {order.flightId}
                        </span>
                        <span>
                          <small>Launch</small>
                          {formatTime(order.launchAt)}
                        </span>
                        <span>
                          <small>Destination</small>
                          {order.zone}
                        </span>
                      </span>
                      <span className="assignment-order-choice">
                        Keep this assignment
                        <ArrowRight size={13} />
                      </span>

                      <span className="assignment-order-hover">
                        <strong>{order.orderId}</strong>
                        <span>
                          <small>Merchant</small>
                          {order.merchant}
                        </span>
                        <span>
                          <small>Aircraft / flight</small>
                          {order.droneId} · {order.flightId}
                        </span>
                        <span>
                          <small>Requested / launch</small>
                          {formatTime(order.requestedAt)} · {formatTime(order.launchAt)}
                        </span>
                        <span>
                          <small>Route</small>
                          {order.siteLabel} → {order.zone} · {order.distanceKm} km
                        </span>
                        <span>
                          <small>Payload / service</small>
                          {order.payloadKg} kg · {displayService(order.serviceLevel)} ·{" "}
                          {order.promisedMinutes} min promise
                        </span>
                        <span>
                          <small>Readiness</small>
                          {order.readinessLabel}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <small className="assignment-resolution-note">
                  Selecting one removes the other aircraft assignment; it does not
                  cancel the other order.
                </small>
              </section>
            )}

          <div className="ticket-workflow">
            {columns.map((column) => (
              <button
                className={column.status === selectedStatus ? "active" : ""}
                key={column.status}
                onClick={() => void onStatusChange(selectedIssue.id, column.status)}
                disabled={
                  Boolean(workflowBusy[selectedIssue.id]) ||
                  (column.status === "resolved" &&
                    ((selectedIssue.clearanceMode === "human_release" &&
                      selectedLifecycle?.state !== "released") ||
                      (selectedIssue.clearanceMode === "automatic" &&
                        selectedLifecycle?.state !== "auto_cleared") ||
                      (selectedIssue.effect === "assignment_conflict" &&
                        selectedLifecycle?.blocksOperations)))
                }
              >
                {column.status === "resolved" ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <CircleDot size={14} />
                )}
                {column.label}
              </button>
            ))}
          </div>

          <div className="recommendation-card instant-recommendation">
            <div className="recommendation-heading">
              <span className="recommendation-icon">
                <Bot size={18} />
              </span>
              <div>
                <strong>Recommended action</strong>
                <small>
                  {loading
                    ? "Updating…"
                    : activeRecommendation.source === "openai"
                      ? "GPT-5.4-mini selection · server-validated"
                      : "Deterministic policy engine"}
                </small>
              </div>
            </div>
            <div className="recommended-action recommended-action-primary">
              <strong>{displayService(activeRecommendation.actionId)}</strong>
            </div>
            <p className="recommendation-decision">
              {activeRecommendation.decisionSummary}
            </p>
            <div className="recommendation-source-details">
              <details>
                <summary>
                  <ShieldAlert size={13} />
                  Policy
                  <span>{activeRecommendation.policyRuleIds.length}</span>
                  <ChevronDown size={12} />
                </summary>
                <div className="reference-chip-list">
                  {activeRecommendation.policyRuleIds.map((ruleId) => {
                    const policy = getPolicyReference(ruleId);
                    return (
                      <button
                        className="reference-chip"
                        type="button"
                        key={ruleId}
                        onClick={() =>
                          setOpenReference({ kind: "policy", value: policy })
                        }
                      >
                        <strong>{policy.title}</strong>
                        <small>{ruleId}</small>
                        <span className="reference-hover-card">
                          <b>{policy.section}</b>
                          {policy.text}
                          <em>Click to open full policy</em>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </details>
              <details>
                <summary>
                  <Database size={13} />
                  Evidence
                  <span>{activeRecommendation.evidenceIds.length}</span>
                  <ChevronDown size={12} />
                </summary>
                <div className="reference-chip-list">
                  {activeRecommendation.evidenceIds.map((evidenceId) => {
                    const item =
                      evidenceById.get(evidenceId) ?? {
                        id: evidenceId,
                        dataset: "Unavailable",
                        label: "Evidence record unavailable",
                        value:
                          "The recommendation returned this ID without the corresponding record.",
                        timestamp: selectedIssue.createdAt,
                      };
                    return (
                      <button
                        className="reference-chip"
                        type="button"
                        key={evidenceId}
                        onClick={() =>
                          setOpenReference({ kind: "evidence", value: item })
                        }
                      >
                        <strong>{item.label}</strong>
                        <small>{item.dataset}</small>
                        <span className="reference-hover-card">
                          <b>{item.label}</b>
                          {item.value}
                          <em>Click to open full evidence</em>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </details>
            </div>
            <div className="recommendation-tool-trace">
              {activeRecommendation.toolsUsed.length ? (
                activeRecommendation.toolsUsed.map((tool, index) => (
                  <span key={`${tool.name}-${index}`}>
                    {displayService(tool.name)}
                    <small>{tool.evidenceCount} sources</small>
                  </span>
                ))
              ) : activeRecommendation.source === "openai" ? (
                <span>
                  GPT-5.4-mini selection
                  <small>Validated issue evidence</small>
                </span>
              ) : (
                <span>
                  Deterministic policy engine
                  <small>Issue evidence only</small>
                </span>
              )}
            </div>
            <small className="recommendation-safety">
              Human approval required. This does not authorize flight or execute an action.
            </small>
            <div className="recommendation-meta">
              <button onClick={onRefresh} disabled={loading}>
                <RefreshCw className={loading ? "spin" : ""} size={13} />
                Refresh
              </button>
            </div>
          </div>

          {activeRecommendation.coordination.required && (
            <section className="coordination-card">
              <div className="coordination-header">
                <span>
                  {selectedRecipient.channel === "Maintenance" ? (
                    <Wrench size={17} />
                  ) : (
                    <UserRound size={17} />
                  )}
                </span>
                <div>
                  <strong>Message recipient</strong>
                  <small>
                    {selectedRecipient.name} · {selectedRecipient.role}
                  </small>
                </div>
                <span className="ai-recipient-note">
                  {selectedRecipient.channel === recommendedRecipient.channel
                    ? "AI suggested"
                    : "Operator selected"}
                </span>
              </div>
              <label className="message-recipient">
                <span>To</span>
                <select
                  value={selectedRecipient.channel}
                  onChange={(event) =>
                    setRecipientByIssue((current) => ({
                      ...current,
                      [selectedIssue.id]: event.target.value,
                    }))
                  }
                >
                  {recipientOptions.map((recipient) => (
                    <option value={recipient.channel} key={recipient.channel}>
                      {recipient.name} — {recipient.role}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
              <label className="message-composer">
                <span>Message</span>
                <textarea
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedIssue.id]: event.target.value,
                    }))
                  }
                  rows={4}
                  aria-label="Coordination message"
                />
              </label>
              <div className="composer-footer">
                <button
                  onClick={() => void sendDraft()}
                  disabled={
                    !draft.trim() || Boolean(workflowBusy[selectedIssue.id])
                  }
                >
                  <Send size={14} />
                  Send to {selectedRecipient.name}
                </button>
              </div>
            </section>
          )}

          <details className="ticket-evidence">
            <summary>
              <span>
                <Database size={15} />
                Evidence
              </span>
              <span>{selectedIssue.evidence.length} sources</span>
            </summary>
            <div className="ticket-evidence-body">
              <div className="rule-list">
                {selectedIssue.ruleIds.map((rule) => (
                  <span key={rule}>{rule}</span>
                ))}
              </div>
              <div className="evidence-list">
                {selectedIssue.evidence.map((item) => (
                  <button
                    className="evidence-item"
                    type="button"
                    key={item.id}
                    onClick={() =>
                      setOpenReference({ kind: "evidence", value: item })
                    }
                  >
                    <Database size={16} />
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.value}</p>
                      <span>
                        {item.dataset} · {formatTime(item.timestamp, true)}
                      </span>
                    </div>
                    <ExternalLink size={14} />
                  </button>
                ))}
              </div>
            </div>
          </details>
            </aside>
          </div>
        )}
      </div>

      {!chatOpen && (
        <button
          className="issue-chat-fab"
          type="button"
          onClick={() => openIssueChat()}
          aria-label={`Open issue chat${totalMessageCount ? `, ${totalMessageCount} messages` : ""}`}
        >
          <MessageSquare size={19} />
          <span>Chat</span>
          {totalMessageCount > 0 && <b>{totalMessageCount}</b>}
        </button>
      )}

      {chatOpen && (
        <div
          className={`issue-chat-layer ${chatExpanded ? "expanded" : ""}`}
          role="dialog"
          aria-modal={chatExpanded}
          aria-label={`Chat for ${selectedIssue.title}`}
        >
          {chatExpanded && (
            <button
              className="issue-chat-backdrop"
              type="button"
              onClick={closeIssueChat}
              aria-label="Close issue chat"
            />
          )}
          <section className={`issue-chat-window ${chatExpanded ? "expanded" : ""}`}>
            <header>
              <div>
                <span>ISSUE CHAT</span>
                <label className="issue-chat-selector">
                  <span>Conversation</span>
                  <select
                    value={selectedIssue.id}
                    onChange={(event) => onSelect(event.target.value)}
                  >
                    {issues.map((issue) => (
                      <option value={issue.id} key={issue.id}>
                        {issue.priority} · {issue.title}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} />
                </label>
                <label className="issue-chat-recipient">
                  <span>Message to</span>
                  <select
                    value={selectedRecipient.channel}
                    onChange={(event) =>
                      setRecipientByIssue((current) => ({
                        ...current,
                        [selectedIssue.id]: event.target.value,
                      }))
                    }
                  >
                    {recipientOptions.map((recipient) => (
                      <option value={recipient.channel} key={recipient.channel}>
                        {recipient.name} — {recipient.role}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              <div className="issue-chat-window-actions">
                <button
                  type="button"
                  onClick={() => setChatExpanded((current) => !current)}
                  aria-label={chatExpanded ? "Restore chat window" : "Expand chat window"}
                  title={chatExpanded ? "Restore window" : "Expand"}
                >
                  {chatExpanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                </button>
                <button type="button" onClick={closeIssueChat} aria-label="Close chat">
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="issue-chat-window-messages">
              {selectedMessages.map((message) => (
                <article className="thread-message" key={message.id}>
                  <span className="message-avatar">
                    {message.senderName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <span className="message-byline">
                      <strong>
                        {message.senderName} → {message.channel}
                      </strong>
                      <small>
                        {formatTime(message.createdAt)}
                      </small>
                    </span>
                    <p>{message.body}</p>
                  </div>
                </article>
              ))}
              {!selectedMessages.length && (
                <div className="thread-empty">
                  <MessageSquare size={20} />
                  <span>No messages yet</span>
                </div>
              )}
            </div>

            <footer>
              <textarea
                value={draft}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [selectedIssue.id]: event.target.value,
                  }))
                }
                rows={3}
                placeholder="Write a message"
                aria-label="Issue chat message"
              />
              <button
                type="button"
                onClick={() => void sendDraft()}
                disabled={!draft.trim() || Boolean(workflowBusy[selectedIssue.id])}
              >
                <Send size={15} />
                Send to {selectedRecipient.name}
              </button>
            </footer>
          </section>
        </div>
      )}

      {openReference && (
        <div className="reference-modal-layer" role="dialog" aria-modal="true">
          <button
            className="reference-modal-backdrop"
            type="button"
            onClick={() => setOpenReference(null)}
            aria-label="Close reference"
          />
          <article className="reference-modal source-viewer">
            <header>
              <div>
                <span>
                  {openReference.kind === "policy" ? (
                    <FileText size={14} />
                  ) : (
                    <Table2 size={14} />
                  )}
                  {openReference.kind === "policy" ? "POLICY SOURCE" : "EVIDENCE SOURCE"}
                </span>
                <h2>
                  {openReference.kind === "policy"
                    ? openReference.value.title
                    : openReference.value.label}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpenReference(null)}
                aria-label="Close reference"
              >
                <X size={18} />
              </button>
            </header>

            {openReference.kind === "policy" ? (
              <div className="source-viewer-layout">
                <aside className="source-viewer-sidebar">
                  <span className="source-breadcrumb">
                    {openReference.value.source} / {openReference.value.section}
                  </span>
                  <dl>
                    <div>
                      <dt>Policy ID</dt>
                      <dd>{openReference.value.policyId}</dd>
                    </div>
                    <div>
                      <dt>Triggered as</dt>
                      <dd>{openReference.value.requestedId}</dd>
                    </div>
                    <div>
                      <dt>Authority</dt>
                      <dd>
                        {openReference.value.authoritative
                          ? "Authored policy"
                          : "Internal control"}
                      </dd>
                    </div>
                  </dl>
                  {openReference.value.note && (
                    <aside>{openReference.value.note}</aside>
                  )}
                </aside>
                <div className="source-document">
                  {openReference.value.authoritative ? (
                    <>
                      <div className="source-document-heading">
                        <small>{POLICY_DOCUMENT.source}</small>
                        <h3>{POLICY_DOCUMENT.title}</h3>
                        <p>{POLICY_DOCUMENT.notice}</p>
                      </div>
                      {POLICY_DOCUMENT.sections.map((section) => (
                        <section key={section.title}>
                          <h4>{section.title}</h4>
                          {section.paragraphs.map((paragraph) => {
                            const selected =
                              paragraph.policyId === openReference.value.policyId;
                            return (
                              <p
                                className={selected ? "source-target" : ""}
                                key={paragraph.policyId}
                                ref={
                                  selected
                                    ? (node) => {
                                        referenceTargetRef.current = node;
                                      }
                                    : undefined
                                }
                              >
                                <span>{paragraph.policyId}</span>
                                {paragraph.text}
                              </p>
                            );
                          })}
                        </section>
                      ))}
                    </>
                  ) : (
                    <section>
                      <h4>{openReference.value.section}</h4>
                      <p
                        className="source-target"
                        ref={(node) => {
                          referenceTargetRef.current = node;
                        }}
                      >
                        <span>{openReference.value.policyId}</span>
                        {openReference.value.text}
                      </p>
                    </section>
                  )}
                </div>
              </div>
            ) : (
              <div className="source-viewer-layout">
                <aside className="source-viewer-sidebar">
                  <span className="source-breadcrumb">
                    {openReference.value.dataset} / {openReference.value.id}
                  </span>
                  <dl>
                    <div>
                      <dt>Record ID</dt>
                      <dd>{openReference.value.id}</dd>
                    </div>
                    <div>
                      <dt>Dataset</dt>
                      <dd>{openReference.value.dataset}</dd>
                    </div>
                    <div>
                      <dt>Observed</dt>
                      <dd>{formatTime(openReference.value.timestamp, true)}</dd>
                    </div>
                  </dl>
                  <p>
                    Showing the selected record with nearby rows from the same
                    source in this simulation run.
                  </p>
                </aside>
                <div className="source-table-wrap">
                  <div className="source-table-heading">
                    <span>{openReference.value.dataset}</span>
                    <strong>
                      {
                        allEvidence.filter(
                          (item) =>
                            item.dataset === openReference.value.dataset,
                        ).length
                      }{" "}
                      records
                    </strong>
                  </div>
                  <table className="source-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Record</th>
                        <th>Field</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allEvidence
                        .filter(
                          (item) =>
                            item.dataset === openReference.value.dataset,
                        )
                        .sort(
                          (a, b) =>
                            Date.parse(a.timestamp) - Date.parse(b.timestamp),
                        )
                        .map((item) => {
                          const selected = item.id === openReference.value.id;
                          return (
                            <tr
                              className={selected ? "source-target" : ""}
                              key={item.id}
                              ref={
                                selected
                                  ? (node) => {
                                      referenceTargetRef.current = node;
                                    }
                                  : undefined
                              }
                            >
                              <td>{formatTime(item.timestamp, true)}</td>
                              <td><code>{item.id}</code></td>
                              <td>{item.label}</td>
                              <td>{item.value}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {!allEvidence.some(
                    (item) =>
                      item.dataset === openReference.value.dataset &&
                      item.id === openReference.value.id,
                  ) && (
                    <div
                      className="source-record-fallback source-target"
                      ref={(node) => {
                        referenceTargetRef.current = node;
                      }}
                    >
                      <code>{openReference.value.id}</code>
                      <strong>{openReference.value.label}</strong>
                      <span>{openReference.value.value}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <footer className="source-viewer-footer">
              <span>
                Highlighted content is the exact source used by the recommendation.
              </span>
              <button type="button" onClick={() => setOpenReference(null)}>
                Back to recommendation
              </button>
            </footer>
          </article>
        </div>
      )}
    </div>
  );
}

function BatteryGauge({ value }: { value: number }) {
  return (
    <span className="battery-gauge">
      <span className="battery-track">
        <span style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
      </span>
      <strong>{value}%</strong>
    </span>
  );
}

function DrawerShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close details" />
      <aside className="drawer">
        <div className="drawer-header">
          <div>
            <span className="eyebrow">{subtitle}</span>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close details"><X size={19} /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function DroneDrawer({ drone, onClose }: { drone: Drone; onClose: () => void }) {
  return (
    <DrawerShell title={drone.droneId} subtitle="AIRCRAFT DETAIL" onClose={onClose}>
      <div className="drawer-status-line">
        <StatusChip status={drone.status} />
        <span><MapPin size={14} />{drone.siteLabel}</span>
      </div>
      <div className="drawer-callout">
        <strong>{drone.activity}</strong>
        <span>{drone.flightId ?? "No current flight assignment"}</span>
      </div>
      <div className="detail-metric-grid">
        <Metric label="Live battery" value={drone.batteryLevel ?? "—"} suffix={drone.batteryLevel === null ? "" : "%"} tone="violet" />
        <Metric label="Capacity" value={drone.batteryCapacity} suffix="%" />
        <Metric label="Cell spread" value={drone.cellSpread} suffix=" mV" />
        <Metric label="Vibration" value={drone.vibration} suffix=" mm/s" />
      </div>
      <div className="detail-section">
        <span className="section-label">LATEST TELEMETRY</span>
        <dl className="definition-list">
          <div><dt>Flight phase</dt><dd>{drone.phase ?? "No active telemetry"}</dd></div>
          <div><dt>Battery temperature</dt><dd>{drone.batteryTemp === null ? "—" : `${drone.batteryTemp} °C`}</dd></div>
          <div><dt>GPS HDOP</dt><dd>{drone.gpsHdop ?? "—"}</dd></div>
          <div><dt>Tether descent</dt><dd>{drone.tetherDescent} sec</dd></div>
          <div><dt>Last observed</dt><dd>{formatTime(drone.lastTelemetryAt, true)}</dd></div>
        </dl>
      </div>
      <div className="detail-section">
        <span className="section-label">POLICY STATE</span>
        <div className="policy-state-block">
          <ShieldAlert size={18} />
          <div>
            <strong>{displayService(drone.policyState)}</strong>
            <span>
              {drone.policyRules.length
                ? drone.policyRules.join(" · ")
                : "No supplied-policy threshold detected"}
            </span>
          </div>
        </div>
      </div>
    </DrawerShell>
  );
}

function OrderDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <DrawerShell title={order.orderId} subtitle="ORDER + PREFLIGHT" onClose={onClose}>
      <div className="drawer-status-line">
        <StatusChip status={order.status} />
        <span><MapPin size={14} />{order.siteLabel}</span>
      </div>
      <div className="drawer-callout">
        <strong>{order.merchant}</strong>
        <span>{order.zone} · {displayService(order.serviceLevel)} service</span>
      </div>
      <dl className="definition-list">
        <div><dt>Flight</dt><dd>{order.flightId}</dd></div>
        <div><dt>Aircraft</dt><dd>{order.droneId}</dd></div>
        <div><dt>Planned launch</dt><dd>{formatTime(order.launchAt, true)}</dd></div>
        <div><dt>Customer promise</dt><dd>{order.promisedMinutes} minutes</dd></div>
        <div><dt>Payload / route</dt><dd>{order.payloadKg} kg · {order.distanceKm} km</dd></div>
        <div><dt>Readiness</dt><dd>{order.readinessLabel}</dd></div>
      </dl>

      {order.preflightState ? (
        <div className="detail-section">
          <span className="section-label">PREFLIGHT CHECK</span>
          <div className={`preflight-summary preflight-${order.preflightState.toLowerCase()}`}>
            <ShieldAlert size={18} />
            <div>
              <strong>{preflightLabels[order.preflightState]}</strong>
            </div>
          </div>
          <div className="check-list">
            {order.preflightChecks.map((check) => (
              <div className={`check-row check-${check.state}`} key={check.label}>
                <span className="check-icon">
                  {check.state === "clear" ? <Check size={14} /> : <AlertTriangle size={14} />}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
                <small>{check.state}</small>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="drawer-note">
          <Clock3 size={17} />
          Preflight checks appear for upcoming departures.
        </div>
      )}
    </DrawerShell>
  );
}
