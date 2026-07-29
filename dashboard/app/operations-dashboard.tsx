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
  Columns3,
  Database,
  Gauge,
  History,
  ListFilter,
  MapPin,
  MessageSquare,
  PackageCheck,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  UserRound,
  Wind,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import replayData from "./data/live-scenarios.json";

type View = "fleet" | "orders" | "issues";

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
  createdAt: string;
  launchBlocking: boolean;
  humanDecisionRequired: boolean;
  status: string;
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
    policyRuleIds: string[];
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

const scenarios = replayData.scenarios as Scenario[];
const REPLAY_TICK_MS = 250;
const DEFAULT_REPLAY_SPEED = 5;

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
  const actionId = issue.allowedActions[0];
  let contactName = "Operations control";
  let contactRole = "Duty operator";
  let channel = "Ops control";
  let instruction =
    "Please acknowledge this issue, confirm ownership, and post the next verified update here.";

  if (
    actionId.includes("MAINTENANCE") ||
    actionId === "GROUND_AIRCRAFT" ||
    actionId === "AWAIT_VALIDATED_MAINTENANCE_RELEASE"
  ) {
    contactName = "Maintenance team";
    contactRole = "Aircraft maintenance";
    channel = "Maintenance";
    instruction =
      "Please inspect the aircraft, acknowledge ownership, and share the next verified finding here. Do not release the aircraft; the operator must record the validated decision.";
  } else if (
    actionId === "REESTIMATE_PROMISE_FROM_ACTUAL_READY" ||
    actionId === "REQUIRE_HANDOFF_VERIFICATION"
  ) {
    contactName = "Merchant partner";
    contactRole = "Merchant operations";
    channel = "Merchant";
    instruction =
      "Please confirm the actual ready time, identify any blocker, and update this thread when the handoff is ready for verification.";
  } else if (
    actionId === "CUSTOMER_OUTREACH" ||
    actionId === "MARK_DELIVERY_EXCEPTION"
  ) {
    contactName = "Customer support";
    contactRole = "Delivery support";
    channel = "Customer support";
    instruction =
      "Please contact the customer with the current verified status and post the response or next follow-up time in this thread.";
  } else if (
    actionId === "HOLD_LAUNCH" ||
    actionId === "DEFER_ORDER" ||
    actionId === "REASSIGN_ORDER" ||
    actionId === "REMOVE_INVALID_ASSIGNMENT"
  ) {
    contactName = "Site dispatch";
    contactRole = "Flight planning";
    channel = "Dispatch";
    instruction =
      "Please acknowledge the operational hold, confirm the affected assignment, and post the revised plan or next review time here.";
  }

  return {
    status: "ready",
    actionId,
    source: "policy_engine",
    evidenceIds: issue.evidence.map((item) => item.id),
    policyRuleIds: issue.ruleIds,
    humanDecisionRequired: true,
    coordination: {
      required: actionId !== "NO_RECOMMENDATION_INSUFFICIENT_EVIDENCE",
      channel,
      contactName,
      contactRole,
      subject: `${issue.priority} action needed · ${issue.entity}`,
      draftMessage:
        `Hi ${contactName} — Ops opened ${issue.id}: ${issue.title}. ` +
        `${issue.summary} Recommended next action: ${displayService(actionId)}. ${instruction}`,
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

  return {
    ...order,
    status,
    minutesToLaunch: Math.floor((launchAt - replayTime) / 60_000),
    readinessStatus: readinessVisible ? order.readinessStatus : "awaiting_event",
    readinessLabel: readinessVisible ? order.readinessLabel : "Awaiting actual readiness",
    handoffVerified: readinessVisible ? order.handoffVerified : null,
    preflightState: status === "preflight" ? order.preflightState : null,
    preflightChecks: status === "preflight" ? order.preflightChecks : [],
  };
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

export function OperationsDashboard() {
  const [view, setView] = useState<View>("fleet");
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [replayTime, setReplayTime] = useState(() => Date.parse(scenarios[0].timelineStart));
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
  const [workflowBusy, setWorkflowBusy] = useState<Record<string, boolean>>({});
  const recommendationRequests = useRef(new Set<string>());
  const previousReplayTime = useRef(Date.parse(scenarios[0].timelineStart));
  const notifiedIssueIds = useRef(
    new Set(
      scenarios[0].issues
        .filter((issue) => Date.parse(issue.createdAt) <= Date.parse(scenarios[0].timelineStart))
        .map((issue) => issue.id),
    ),
  );

  const scenario = scenarios[scenarioIndex];
  const timelineStart = Date.parse(scenario.timelineStart);
  const timelineEnd = Date.parse(scenario.timelineEnd);

  const activeIssues = useMemo(
    () => scenario.issues.filter((issue) => Date.parse(issue.createdAt) <= replayTime),
    [replayTime, scenario],
  );
  const activeIssueIdsKey = activeIssues.map((issue) => issue.id).join("|");

  const projectedOrders = useMemo(
    () =>
      scenario.orders
        .map((order) => projectOrderAtTime(order, replayTime))
        .filter((order): order is Order => order !== null),
    [replayTime, scenario],
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
        const safetyLocked = ["grounded", "maintenance", "review"].includes(drone.status);
        const hasConflict = active.length > 1 || upcoming.length > 1;

        let status = drone.status;
        let activity = drone.activity;
        if (!safetyLocked) {
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
    [projectedOrders, replayTime, scenario],
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
    ((replayTime - timelineStart) / Math.max(1, timelineEnd - timelineStart)) * 100;

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
    if (!isPlaying || replayTime >= timelineEnd) return;
    const interval = window.setInterval(() => {
      setReplayTime((current) => {
        const next = Math.min(
          timelineEnd,
          current + replaySpeed * 60_000 * (REPLAY_TICK_MS / 1000),
        );
        if (next >= timelineEnd) setIsPlaying(false);
        return next;
      });
    }, REPLAY_TICK_MS);
    return () => window.clearInterval(interval);
  }, [isPlaying, replaySpeed, timelineEnd]);

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
    if (!activeIssues.length) return;
    let cancelled = false;

    async function syncWorkflow() {
      try {
        await fetch("/api/issues", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "sync",
            scenarioId: scenario.id,
            issueIds: activeIssues.map((issue) => issue.id),
          }),
        });
        const response = await fetch(
          `/api/issues?scenarioId=${encodeURIComponent(scenario.id)}`,
        );
        if (!response.ok) throw new Error("Issue workflow request failed");
        const payload = (await response.json()) as {
          tickets: TicketRecord[];
          messages: ChatMessage[];
        };
        if (cancelled) return;
        setTicketRecords((current) => ({
          ...current,
          ...Object.fromEntries(payload.tickets.map((ticket) => [ticket.issueId, ticket])),
        }));
        const grouped = payload.messages.reduce<Record<string, ChatMessage[]>>(
          (result, message) => {
            (result[message.issueId] ??= []).push(message);
            return result;
          },
          {},
        );
        setMessagesByIssue((current) => ({ ...current, ...grouped }));
      } catch {
        // The board remains usable optimistically if persistence is temporarily unavailable.
      }
    }

    void syncWorkflow();
    return () => {
      cancelled = true;
    };
  }, [activeIssueIdsKey, scenario.id]);

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

  function switchScenario(nextIndex: number) {
    const nextScenario = scenarios[nextIndex];
    const start = Date.parse(nextScenario.timelineStart);
    setScenarioIndex(nextIndex);
    setReplayTime(start);
    previousReplayTime.current = start;
    notifiedIssueIds.current = new Set(
      nextScenario.issues
        .filter((issue) => Date.parse(issue.createdAt) <= start)
        .map((issue) => issue.id),
    );
    setIssueQueue([]);
    setToastIssueId(null);
    setIsPlaying(true);
    setSelectedDroneId(null);
    setSelectedOrderId(null);
    setSelectedIssueId(
      nextScenario.issues.find((issue) => Date.parse(issue.createdAt) <= start)?.id ??
        null,
    );
  }

  function restartReplay() {
    setReplayTime(timelineStart);
    previousReplayTime.current = timelineStart;
    notifiedIssueIds.current = new Set(
      scenario.issues
        .filter((issue) => Date.parse(issue.createdAt) <= timelineStart)
        .map((issue) => issue.id),
    );
    setIssueQueue([]);
    setToastIssueId(null);
    setSelectedIssueId(
      scenario.issues.find((issue) => Date.parse(issue.createdAt) <= timelineStart)?.id ??
        null,
    );
    setIsPlaying(true);
  }

  function seekReplay(nextTime: number) {
    setReplayTime(nextTime);
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
    if (replayTime >= timelineEnd) {
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

  async function ensureTicketStored(issueId: string) {
    await fetch("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "sync",
        scenarioId: scenario.id,
        issueIds: [issueId],
      }),
    });
  }

  async function updateTicketStatus(issueId: string, status: TicketStatus) {
    const now = new Date().toISOString();
    const previous = ticketRecords[issueId];
    const optimistic: TicketRecord = {
      issueId,
      scenarioId: scenario.id,
      status,
      owner: status === "new" ? previous?.owner ?? "Unassigned" : "You",
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      resolvedAt: status === "resolved" ? now : null,
    };
    setTicketRecords((current) => ({ ...current, [issueId]: optimistic }));
    setWorkflowBusy((current) => ({ ...current, [issueId]: true }));
    try {
      await ensureTicketStored(issueId);
      const response = await fetch("/api/issues", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issueId,
          status,
          owner: optimistic.owner,
        }),
      });
      if (!response.ok) throw new Error("Ticket status update failed");
      const payload = (await response.json()) as { ticket: TicketRecord };
      setTicketRecords((current) => ({
        ...current,
        [issueId]: payload.ticket,
      }));
    } catch {
      setTicketRecords((current) => {
        const next = { ...current };
        if (previous) next[issueId] = previous;
        else delete next[issueId];
        return next;
      });
    } finally {
      setWorkflowBusy((current) => ({ ...current, [issueId]: false }));
    }
  }

  async function sendIssueMessage(
    issueId: string,
    channel: string,
    body: string,
  ) {
    const tempId = -Date.now();
    const optimistic: ChatMessage = {
      id: tempId,
      issueId,
      channel,
      senderName: "You",
      senderRole: "operator",
      body,
      createdAt: new Date().toISOString(),
    };
    setMessagesByIssue((current) => ({
      ...current,
      [issueId]: [...(current[issueId] ?? []), optimistic],
    }));
    setWorkflowBusy((current) => ({ ...current, [issueId]: true }));
    try {
      await ensureTicketStored(issueId);
      const response = await fetch("/api/issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "message",
          issueId,
          channel,
          body,
          senderName: "You",
          senderRole: "operator",
        }),
      });
      if (!response.ok) throw new Error("Message send failed");
      const payload = (await response.json()) as { message: ChatMessage };
      setMessagesByIssue((current) => ({
        ...current,
        [issueId]: (current[issueId] ?? []).map((message) =>
          message.id === tempId ? payload.message : message,
        ),
      }));
      await updateTicketStatus(issueId, "waiting");
    } catch {
      setMessagesByIssue((current) => ({
        ...current,
        [issueId]: (current[issueId] ?? []).filter(
          (message) => message.id !== tempId,
        ),
      }));
    } finally {
      setWorkflowBusy((current) => ({ ...current, [issueId]: false }));
    }
  }

  function openIssues(issueId?: string) {
    setView("issues");
    setSelectedIssueId(issueId ?? activeIssues[0]?.id ?? null);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <span className="brand-word">ZIPLINE</span>
          <span className="brand-product">Operations</span>
        </div>

        <div className="product-mode">
          <span className="live-pulse" />
          Live operations
        </div>

        <nav className="primary-nav">
          <button
            className={view === "fleet" ? "active" : ""}
            onClick={() => setView("fleet")}
          >
            <Gauge size={19} />
            Fleet
          </button>
          <button
            className={view === "orders" ? "active" : ""}
            onClick={() => setView("orders")}
          >
            <PackageCheck size={19} />
            Orders
          </button>
          <button
            className={view === "issues" ? "active" : ""}
            onClick={() => openIssues()}
          >
            <ShieldAlert size={19} />
            Issues
            <span className="nav-badge">{activeIssues.length}</span>
          </button>
        </nav>

        <div className="sidebar-divider" />
        <div className="future-mode">
          <History size={18} />
          <div>
            <span>History + analysis</span>
            <small>Next product area</small>
          </div>
        </div>

        <div className="sidebar-note">
          <Database size={17} />
          <p>
            Synthetic data replay
            <span>11 datasets + policy evidence</span>
          </p>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="replay-selector">
            <label htmlFor="scenario">Replay scenario</label>
            <div className="select-wrap">
              <select
                id="scenario"
                value={scenarioIndex}
                onChange={(event) => switchScenario(Number(event.target.value))}
              >
                {scenarios.map((option, index) => (
                  <option key={option.id} value={index}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
          </div>

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
              : replayTime >= timelineEnd
                ? "Replay again"
                : "Resume"}
          </button>

          <button
            className="notification-button"
            aria-label={`${activeIssues.length} active issues`}
            onClick={() => openIssues()}
          >
            <Bell size={19} />
            <span>{activeIssues.length}</span>
          </button>
        </header>

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
              min={timelineStart}
              max={timelineEnd}
              step={60_000}
              value={replayTime}
              onChange={(event) => seekReplay(Number(event.target.value))}
              aria-label="Replay position"
              style={{ "--replay-progress": `${replayProgress}%` } as React.CSSProperties}
            />
            <div>
              <span>{formatTime(scenario.timelineStart)}</span>
              <strong>{Math.round(replayProgress)}%</strong>
              <span>{formatTime(scenario.timelineEnd)}</span>
            </div>
          </div>
          <label className="speed-control">
            <span>Replay speed</span>
            <select
              value={replaySpeed}
              onChange={(event) => setReplaySpeed(Number(event.target.value))}
            >
              <option value={1}>1 min/sec</option>
              <option value={5}>5 min/sec</option>
              <option value={15}>15 min/sec</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </section>

        <section className="scenario-banner">
          <div>
            <span className="eyebrow">LIVE DATA REPLAY</span>
            <strong>{scenario.label}</strong>
            <p>{scenario.description}</p>
          </div>
          <div className="policy-banner">
            <ShieldAlert size={18} />
            <span>
              Human decision required
              <small>The dashboard never authorizes flight.</small>
            </span>
          </div>
        </section>

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
              selectedIssue={selectedIssue}
              onSelect={setSelectedIssueId}
              recommendation={recommendations[selectedIssue.id]}
              onRefresh={() => refreshRecommendation(selectedIssue, true)}
              loading={Boolean(recommendationLoading[selectedIssue.id])}
              tickets={ticketRecords}
              messages={messagesByIssue}
              workflowBusy={workflowBusy}
              onStatusChange={updateTicketStatus}
              onSendMessage={sendIssueMessage}
            />
          ) : (
            <EmptyIssues replayTime={replayTime} />
          ))}
      </main>

      {selectedDrone && (
        <DroneDrawer drone={selectedDrone} onClose={() => setSelectedDroneId(null)} />
      )}
      {selectedOrder && (
        <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrderId(null)} />
      )}
      {toastIssue && (
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

      <div className="weather-strip">
        {scenario.weather.map((weather) => {
          const observed = Date.parse(weather.observedAt) <= replayTime;
          return (
            <div
              className={`weather-card weather-${observed ? weather.policyState : "awaiting"}`}
              key={weather.site}
            >
              <div className="weather-title">
                <CloudSun size={18} />
                <strong>{weather.siteLabel}</strong>
                <span>{observed ? weather.policyState : "awaiting"}</span>
              </div>
              <div className="weather-values">
                <span>
                  <Wind size={14} />
                  {observed ? weather.wind : "—"} <small>kph</small>
                </span>
                <span>
                  Gust {observed ? weather.gust : "—"} <small>kph</small>
                </span>
                <span>
                  Vis {observed ? weather.visibility : "—"} <small>km</small>
                </span>
              </div>
            </div>
          );
        })}
      </div>

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

function EmptyIssues({ replayTime }: { replayTime: number }) {
  return (
    <div className="page-content issues-page">
      <div className="page-heading">
        <div>
          <h1>Urgent issues</h1>
        </div>
        <div className="heading-status">
          <Clock3 size={16} />
          {formatTime(new Date(replayTime).toISOString())}
        </div>
      </div>
      <div className="panel empty-issues">
        <ShieldAlert size={22} />
        <strong>No active issues at this replay time</strong>
        <span>New issues will appear here when their event time is reached.</span>
      </div>
    </div>
  );
}

function IssuesView({
  issues,
  selectedIssue,
  onSelect,
  recommendation,
  onRefresh,
  loading,
  tickets,
  messages,
  workflowBusy,
  onStatusChange,
  onSendMessage,
}: {
  issues: Issue[];
  selectedIssue: Issue;
  onSelect: (issueId: string) => void;
  recommendation?: RecommendationResult;
  onRefresh: () => void;
  loading: boolean;
  tickets: Record<string, TicketRecord>;
  messages: Record<string, ChatMessage[]>;
  workflowBusy: Record<string, boolean>;
  onStatusChange: (issueId: string, status: TicketStatus) => Promise<void>;
  onSendMessage: (
    issueId: string,
    channel: string,
    body: string,
  ) => Promise<void>;
}) {
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const activeRecommendation =
    recommendation ?? buildImmediateRecommendation(selectedIssue);
  const selectedTicket = tickets[selectedIssue.id];
  const selectedStatus = selectedTicket?.status ?? "new";
  const selectedMessages = messages[selectedIssue.id] ?? [];
  const draft =
    drafts[selectedIssue.id] ??
    activeRecommendation.coordination.draftMessage;
  const openCount = issues.filter(
    (issue) => (tickets[issue.id]?.status ?? "new") !== "resolved",
  ).length;
  const waitingCount = issues.filter(
    (issue) => (tickets[issue.id]?.status ?? "new") === "waiting",
  ).length;
  const blockingCount = issues.filter(
    (issue) =>
      issue.launchBlocking &&
      (tickets[issue.id]?.status ?? "new") !== "resolved",
  ).length;
  const columns: Array<{
    status: TicketStatus;
    label: string;
    description: string;
  }> = [
    { status: "new", label: "New", description: "AI triaged" },
    { status: "in_progress", label: "In progress", description: "Operator owned" },
    { status: "waiting", label: "Waiting on team", description: "Handoff sent" },
    { status: "resolved", label: "Resolved", description: "Human closed" },
  ];

  async function sendDraft() {
    const body = draft.trim();
    if (!body) return;
    setDrafts((current) => ({ ...current, [selectedIssue.id]: "" }));
    await onSendMessage(
      selectedIssue.id,
      activeRecommendation.coordination.channel,
      body,
    );
  }

  return (
    <div className="page-content issues-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">AI-ASSISTED ISSUE OPERATIONS</span>
          <h1>Issue command board</h1>
          <p>
            Every issue is triaged on arrival, coordinated in one thread, and kept
            open until an operator records the resolution.
          </p>
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
          <div className="kanban-toolbar">
            <div>
              <Columns3 size={17} />
              <strong>Live workflow</strong>
              <span>Drag tickets or use the status controls</span>
            </div>
            <span className="auto-triage-chip">
              <Bot size={14} />
              Auto-triage on
            </span>
          </div>
          <div className="kanban-board">
            {columns.map((column) => {
              const columnIssues = issues.filter(
                (issue) => (tickets[issue.id]?.status ?? "new") === column.status,
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
                      <small>{column.description}</small>
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
                          onClick={() => onSelect(issue.id)}
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
                          <p>{issue.summary}</p>
                          <span className="kanban-ai-preview">
                            <Bot size={13} />
                            {displayService(
                              issueRecommendation?.actionId ??
                                issue.allowedActions[0],
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

        <aside className="panel issue-detail ticket-inspector">
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
            <span className={`ticket-status-chip ticket-status-${selectedStatus}`}>
              {columns.find((column) => column.status === selectedStatus)?.label}
            </span>
          </div>

          <div className="ticket-workflow">
            {columns.map((column) => (
              <button
                className={column.status === selectedStatus ? "active" : ""}
                key={column.status}
                onClick={() => void onStatusChange(selectedIssue.id, column.status)}
                disabled={Boolean(workflowBusy[selectedIssue.id])}
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
                <strong>Recommended on arrival</strong>
                <small>
                  {loading
                    ? "Policy action ready · OpenAI is refining the handoff"
                    : activeRecommendation.source === "openai"
                      ? "OpenAI validated against evidence and allowed actions"
                      : "Policy-grounded action · OpenAI key not connected"}
                </small>
              </div>
            </div>
            <div className="recommended-action recommended-action-primary">
              <span>Next best action</span>
              <strong>{displayService(activeRecommendation.actionId)}</strong>
            </div>
            <div className="recommendation-meta">
              <span>{activeRecommendation.evidenceIds.length} evidence points</span>
              <span>{activeRecommendation.policyRuleIds.length} policy rules</span>
              <button onClick={onRefresh} disabled={loading}>
                <RefreshCw className={loading ? "spin" : ""} size={13} />
                Re-check
              </button>
            </div>
          </div>

          {activeRecommendation.coordination.required && (
            <section className="coordination-card">
              <div className="coordination-header">
                <span>
                  {activeRecommendation.coordination.channel === "Maintenance" ? (
                    <Wrench size={17} />
                  ) : (
                    <UserRound size={17} />
                  )}
                </span>
                <div>
                  <strong>Prepared handoff</strong>
                  <small>
                    To {activeRecommendation.coordination.contactName} ·{" "}
                    {activeRecommendation.coordination.contactRole}
                  </small>
                </div>
                <span className="draft-ready">Ready</span>
              </div>
              <label className="message-subject">
                <span>SUBJECT</span>
                <input
                  value={activeRecommendation.coordination.subject}
                  readOnly
                  aria-label="Prepared message subject"
                />
              </label>
              <label className="message-composer">
                <span>MESSAGE</span>
                <textarea
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedIssue.id]: event.target.value,
                    }))
                  }
                  rows={6}
                  aria-label="Prepared coordination message"
                />
              </label>
              <div className="composer-footer">
                <span>
                  <Bot size={13} />
                  Prepared from this ticket only
                </span>
                <button
                  onClick={() => void sendDraft()}
                  disabled={
                    !draft.trim() || Boolean(workflowBusy[selectedIssue.id])
                  }
                >
                  <Send size={14} />
                  Send to {activeRecommendation.coordination.channel}
                </button>
              </div>
            </section>
          )}

          <section className="issue-thread">
            <div className="thread-heading">
              <div>
                <MessageSquare size={16} />
                <strong>Issue chat</strong>
              </div>
              <span>{selectedMessages.length} messages</span>
            </div>
            <div className="thread-messages">
              {selectedMessages.map((message) => (
                <div className="thread-message" key={message.id}>
                  <span className="message-avatar">
                    {message.senderName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <span className="message-byline">
                      <strong>{message.senderName}</strong>
                      <small>
                        {message.channel} · {formatTime(message.createdAt)}
                      </small>
                    </span>
                    <p>{message.body}</p>
                  </div>
                </div>
              ))}
              {!selectedMessages.length && (
                <div className="thread-empty">
                  <MessageSquare size={18} />
                  <span>
                    No messages yet. The prepared handoff above starts the thread
                    in one click.
                  </span>
                </div>
              )}
            </div>
          </section>

          <div className="human-gate">
            <ShieldAlert size={19} />
            <div>
              <strong>Ticket stays open until a human resolves it</strong>
              <p>
                AI can recommend and draft outreach, but cannot authorize, clear,
                release, or close a flight issue.
              </p>
            </div>
          </div>

          <details className="ticket-evidence">
            <summary>
              <span>
                <Database size={15} />
                Evidence and policy basis
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
                  <div className="evidence-item" key={item.id}>
                    <Database size={16} />
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.value}</p>
                      <span>
                        {item.dataset} · {formatTime(item.timestamp, true)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </aside>
      </div>
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
              <span>Human release decision is still required.</span>
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
