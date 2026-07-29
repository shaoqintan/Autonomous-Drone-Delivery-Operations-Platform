"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  CloudSun,
  Database,
  Gauge,
  History,
  ListFilter,
  MapPin,
  PackageCheck,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Wind,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  | {
      status: "ready";
      actionId: string;
      source: "openai";
      evidenceIds: string[];
      policyRuleIds: string[];
      humanDecisionRequired: true;
    }
  | {
      status: "not_configured" | "unavailable";
      actionId: null;
      source: null;
      evidenceIds: [];
      policyRuleIds: [];
      humanDecisionRequired: true;
    };

const scenarios = replayData.scenarios as Scenario[];

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
  return value.replace("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
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
  const [fleetQuery, setFleetQuery] = useState("");
  const [fleetFilter, setFleetFilter] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState("all");
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Record<string, RecommendationResult>>({});
  const [recommendationLoading, setRecommendationLoading] = useState(false);

  const scenario = scenarios[scenarioIndex];
  const selectedDrone = scenario.drones.find((drone) => drone.droneId === selectedDroneId) ?? null;
  const selectedOrder = scenario.orders.find((order) => order.orderId === selectedOrderId) ?? null;
  const selectedIssue =
    scenario.issues.find((issue) => issue.id === selectedIssueId) ??
    scenario.issues[0] ??
    null;

  useEffect(() => {
    if (scenario.issues.length && !scenario.issues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(scenario.issues[0].id);
    }
  }, [scenario, selectedIssueId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredDrones = useMemo(() => {
    const query = fleetQuery.trim().toLowerCase();
    return scenario.drones.filter((drone) => {
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
  }, [fleetFilter, fleetQuery, scenario]);

  const filteredOrders = useMemo(() => {
    const query = orderQuery.trim().toLowerCase();
    return scenario.orders.filter((order) => {
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
  }, [orderFilter, orderQuery, scenario]);

  function switchScenario(nextIndex: number) {
    const nextScenario = scenarios[nextIndex];
    setScenarioIndex(nextIndex);
    setSelectedDroneId(null);
    setSelectedOrderId(null);
    setSelectedIssueId(nextScenario.issues[0]?.id ?? null);
    setToast(
      `${nextScenario.summary.openIssues} active issue${nextScenario.summary.openIssues === 1 ? "" : "s"} detected in ${nextScenario.label}.`,
    );
  }

  function advanceReplay() {
    switchScenario((scenarioIndex + 1) % scenarios.length);
  }

  async function refreshRecommendation(issue: Issue) {
    setRecommendationLoading(true);
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
        [issue.id]: {
          status: "unavailable",
          actionId: null,
          source: null,
          evidenceIds: [],
          policyRuleIds: [],
          humanDecisionRequired: true,
        },
      }));
    } finally {
      setRecommendationLoading(false);
    }
  }

  function openIssues() {
    setView("issues");
    setSelectedIssueId(scenario.issues[0]?.id ?? null);
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
            onClick={openIssues}
          >
            <ShieldAlert size={19} />
            Issues
            <span className="nav-badge">{scenario.summary.openIssues}</span>
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
              <span>{formatTime(scenario.now, true)}</span>
              <small>Replay clock</small>
            </div>
          </div>

          <button className="advance-button" onClick={advanceReplay}>
            <Play size={15} fill="currentColor" />
            Advance replay
          </button>

          <button
            className="notification-button"
            aria-label={`${scenario.summary.openIssues} active issues`}
            onClick={openIssues}
          >
            <Bell size={19} />
            <span>{scenario.summary.openIssues}</span>
          </button>
        </header>

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
            query={fleetQuery}
            setQuery={setFleetQuery}
            filter={fleetFilter}
            setFilter={setFleetFilter}
            onSelect={setSelectedDroneId}
          />
        )}

        {view === "orders" && (
          <OrdersView
            scenario={scenario}
            orders={filteredOrders}
            query={orderQuery}
            setQuery={setOrderQuery}
            filter={orderFilter}
            setFilter={setOrderFilter}
            onSelect={setSelectedOrderId}
          />
        )}

        {view === "issues" && selectedIssue && (
          <IssuesView
            issues={scenario.issues}
            selectedIssue={selectedIssue}
            onSelect={setSelectedIssueId}
            recommendation={recommendations[selectedIssue.id]}
            onRefresh={() => refreshRecommendation(selectedIssue)}
            loading={recommendationLoading}
          />
        )}
      </main>

      {selectedDrone && (
        <DroneDrawer drone={selectedDrone} onClose={() => setSelectedDroneId(null)} />
      )}
      {selectedOrder && (
        <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrderId(null)} />
      )}
      {toast && (
        <button className="live-toast" onClick={openIssues}>
          <span className="toast-icon">
            <Bell size={17} />
          </span>
          <span>
            <strong>Live issue update</strong>
            <small>{toast}</small>
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
  query,
  setQuery,
  filter,
  setFilter,
  onSelect,
}: {
  scenario: Scenario;
  drones: Drone[];
  query: string;
  setQuery: (value: string) => void;
  filter: string;
  setFilter: (value: string) => void;
  onSelect: (droneId: string) => void;
}) {
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>Fleet status</h1>
        </div>
        <div className="heading-status">
          <CircleDot size={16} />
          24 aircraft reporting
        </div>
      </div>

      <div className="metric-grid">
        <Metric label="Airborne" value={scenario.summary.airborne} tone="violet" />
        <Metric label="Preflight" value={scenario.summary.preflight} />
        <Metric label="Grounded" value={scenario.summary.grounded} tone="critical" />
        <Metric label="Assignment conflicts" value={scenario.summary.conflicts} />
      </div>

      <div className="weather-strip">
        {scenario.weather.map((weather) => (
          <div className={`weather-card weather-${weather.policyState}`} key={weather.site}>
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
  scenario,
  orders,
  query,
  setQuery,
  filter,
  setFilter,
  onSelect,
}: {
  scenario: Scenario;
  orders: Order[];
  query: string;
  setQuery: (value: string) => void;
  filter: string;
  setFilter: (value: string) => void;
  onSelect: (orderId: string) => void;
}) {
  const preflightCount = scenario.orders.filter((order) => order.status === "preflight").length;
  const waitingCount = scenario.orders.filter((order) => order.readinessStatus === "awaiting_event").length;
  const inFlightCount = scenario.orders.filter((order) => order.status === "in_flight").length;

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

function IssuesView({
  issues,
  selectedIssue,
  onSelect,
  recommendation,
  onRefresh,
  loading,
}: {
  issues: Issue[];
  selectedIssue: Issue;
  onSelect: (issueId: string) => void;
  recommendation?: RecommendationResult;
  onRefresh: () => void;
  loading: boolean;
}) {
  const recommendationReady =
    recommendation?.status === "ready" && recommendation.actionId;
  return (
    <div className="page-content issues-page">
      <div className="page-heading">
        <div>
          <h1>Urgent issues</h1>
        </div>
        <div className="heading-status urgent">
          <AlertTriangle size={16} />
          {issues.length} active issues
        </div>
      </div>

      <div className="issues-layout">
        <section className="panel issue-list-panel" aria-label="Prioritized issues">
          <div className="panel-toolbar issue-toolbar">
            <div>
              <h2>Priority queue</h2>
              <span>P0 first · launch-blocking before review</span>
            </div>
          </div>
          <div className="issue-list">
            {issues.map((issue) => (
              <button
                className={`issue-row ${issue.id === selectedIssue.id ? "selected" : ""}`}
                key={issue.id}
                onClick={() => onSelect(issue.id)}
              >
                <span className={`severity-rail severity-${issue.priority.toLowerCase()}`} />
                <PriorityChip priority={issue.priority} />
                <span className="issue-row-copy">
                  <strong>{issue.title}</strong>
                  <small>{issue.summary}</small>
                  <span>
                    {issue.category}
                    <b>•</b>
                    {formatTime(issue.createdAt)}
                  </span>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel issue-detail">
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
            <span className="open-chip">Open</span>
          </div>

          <div className="recommendation-card">
            <div className="recommendation-heading">
              <span className="recommendation-icon">
                <Bot size={18} />
              </span>
              <div>
                <strong>OpenAI recommendation</strong>
                <small>
                  {recommendation?.status === "ready"
                    ? "Validated against the evidence and allowed actions"
                    : recommendation?.status === "unavailable"
                      ? "Request unavailable"
                      : "OPENAI_API_KEY not configured"}
                </small>
              </div>
            </div>
            <p>{recommendationReady ? displayService(recommendation.actionId) : "—"}</p>
            <button className="ai-button" onClick={onRefresh} disabled={loading}>
              {loading ? <RefreshCw className="spin" size={16} /> : <Bot size={16} />}
              {loading
                ? "Validating…"
                : recommendationReady
                  ? "Run again"
                  : "Generate recommendation"}
            </button>
          </div>

          <div className="human-gate">
            <ShieldAlert size={19} />
            <div>
              <strong>Human decision required</strong>
              <p>OpenAI cannot authorize, clear, or release a flight.</p>
            </div>
          </div>

          <div className="detail-section">
            <span className="section-label">POLICY / RULE BASIS</span>
            <div className="rule-list">
              {selectedIssue.ruleIds.map((rule) => (
                <span key={rule}>{rule}</span>
              ))}
            </div>
          </div>

          <div className="detail-section">
            <span className="section-label">VALIDATED EVIDENCE</span>
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

          <div className="detail-section">
            <span className="section-label">ALLOWED ACTIONS</span>
            <div className="allowed-actions">
              {selectedIssue.allowedActions.map((action, index) => (
                <span key={action}>
                  {index === 0 ? <Zap size={13} /> : <Check size={13} />}
                  {displayService(action)}
                </span>
              ))}
            </div>
          </div>
        </section>
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
