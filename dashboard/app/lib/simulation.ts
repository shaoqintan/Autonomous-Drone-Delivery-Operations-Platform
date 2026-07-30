export type SimulationEvidence = {
  id: string;
  dataset: string;
  label: string;
  value: string;
  timestamp: string;
};

export type SimulationIssue = {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  category: string;
  title: string;
  summary: string;
  entity: string;
  ruleIds: string[];
  evidence: SimulationEvidence[];
  allowedActions: string[];
  defaultAction: string;
  createdAt: string;
  launchBlocking: boolean;
  humanDecisionRequired: true;
  status: "open";
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
  recoveryEvidence: SimulationEvidence[];
  affectedOrderIds: string[];
  affectedDroneIds: string[];
};

export type SimulationOrder = {
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
  preflightChecks: Array<{
    label: string;
    state: "clear" | "review" | "blocked";
    detail: string;
  }>;
};

export type SimulationDrone = {
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

export type SimulationWeather = {
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

export type SimulationScenario = {
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
  weather: SimulationWeather[];
  drones: SimulationDrone[];
  orders: SimulationOrder[];
  issues: SimulationIssue[];
};

type Site = {
  id: string;
  label: string;
  zones: string[];
};

type Merchant = {
  id: string;
  name: string;
  category: string;
};

const SITES: Site[] = [
  {
    id: "South San Francisco",
    label: "South San Francisco",
    zones: ["Oyster Point", "San Bruno", "Millbrae", "Burlingame"],
  },
  {
    id: "North Hills",
    label: "North Hills",
    zones: ["North Hills", "Lakeview", "Cedar Park", "West Ridge"],
  },
  {
    id: "Eastside",
    label: "Eastside",
    zones: ["Eastside", "Riverside", "Maple District", "University"],
  },
];

const MERCHANTS: Merchant[] = [
  { id: "M-CRISP", name: "Crisp & Co.", category: "Prepared Food" },
  { id: "M-PASTA", name: "Pasta Pantry", category: "Prepared Food" },
  { id: "M-GREEN", name: "Green Basket", category: "Grocery" },
  { id: "M-CARE", name: "Care Pharmacy", category: "Pharmacy" },
  { id: "M-BAKE", name: "Baker Street", category: "Bakery" },
  { id: "M-MARKET", name: "Neighborhood Market", category: "Grocery" },
];

const GENERATED_FROM = [
  "commercial_orders.csv",
  "commercial_delivery_operations.csv",
  "merchant_readiness_events.csv",
  "flight_telemetry_phases.csv",
  "drone_health_daily.csv",
  "maintenance_events.csv",
  "service_area_weather_hourly.csv",
  "operating_policy_rules.csv",
];

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class SeededRandom {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed) || 0x6d2b79f5;
  }

  next() {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(minimum: number, maximum: number) {
    return Math.floor(this.next() * (maximum - minimum + 1)) + minimum;
  }

  chance(probability: number) {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  shuffle<T>(items: readonly T[]) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = this.int(0, index);
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }
}

function at(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

function minutesBetween(later: string, earlier: string) {
  return Math.round((Date.parse(later) - Date.parse(earlier)) / 60_000);
}

function round(value: number, places = 1) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function shortSeed(seed: string) {
  return hashSeed(seed).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

function evidence(
  id: string,
  dataset: string,
  label: string,
  value: string,
  timestamp: string,
): SimulationEvidence {
  return { id, dataset, label, value, timestamp };
}

function issue(
  value: Omit<
    SimulationIssue,
    "humanDecisionRequired" | "status" | "recoveryEvidence"
  > & { recoveryEvidence?: SimulationEvidence[] },
): SimulationIssue {
  if (!value.allowedActions.includes(value.defaultAction)) {
    throw new Error(`Invalid default action for ${value.id}`);
  }
  return {
    ...value,
    recoveryEvidence: value.recoveryEvidence ?? [],
    humanDecisionRequired: true,
    status: "open",
  };
}

function validateSimulation(scenario: SimulationScenario) {
  const orderIds = new Set(scenario.orders.map((order) => order.orderId));
  const droneIds = new Set(scenario.drones.map((drone) => drone.droneId));

  for (const order of scenario.orders) {
    const requestedAt = Date.parse(order.requestedAt);
    const readinessAt = Date.parse(order.readinessEventAt ?? "");
    const launchAt = Date.parse(order.launchAt);
    const deliveredAt = order.deliveredAt ? Date.parse(order.deliveredAt) : null;
    if (
      !Number.isFinite(requestedAt) ||
      !Number.isFinite(readinessAt) ||
      !Number.isFinite(launchAt) ||
      requestedAt > readinessAt ||
      readinessAt > launchAt ||
      (deliveredAt !== null && launchAt > deliveredAt) ||
      !droneIds.has(order.droneId)
    ) {
      throw new Error(`Generated order sequence is invalid: ${order.orderId}`);
    }
  }

  for (const item of scenario.issues) {
    if (
      !item.allowedActions.includes(item.defaultAction) ||
      item.affectedOrderIds.some((orderId) => !orderIds.has(orderId)) ||
      item.affectedDroneIds.some((droneId) => !droneIds.has(droneId)) ||
      (item.recoveryAt !== null &&
        Date.parse(item.recoveryAt) < Date.parse(item.createdAt))
    ) {
      throw new Error(`Generated issue contract is invalid: ${item.id}`);
    }
  }
  return scenario;
}

export function createSimulationSeed() {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  return `${Date.now().toString(36)}-${values[0].toString(36)}${values[1].toString(36)}`;
}

export function generateSimulation(seed: string): SimulationScenario {
  const normalizedSeed = seed.trim().slice(0, 80) || "default";
  const random = new SeededRandom(normalizedSeed);
  const token = shortSeed(normalizedSeed);
  const base = new Date(
    Date.UTC(2026, 6, 29 + random.int(0, 20), random.int(14, 17), 0, 0),
  );
  const runId = `SIM-${token}`;
  const timelineEndMinute = 300;
  const droneCount = random.int(9, 12);
  const orderCount = random.int(18, 26);

  const drones: SimulationDrone[] = Array.from(
    { length: droneCount },
    (_, index) => {
      const site = SITES[index % SITES.length];
      const droneId = `ZIP-SIM-${String(index + 1).padStart(3, "0")}`;
      return {
        droneId,
        site: site.id,
        siteLabel: site.label,
        status: "idle",
        activity: "Idle · available for planning",
        flightId: null,
        orderId: null,
        batteryLevel: random.int(48, 98),
        batteryCapacity: round(random.int(880, 1000) / 10),
        cellSpread: random.int(8, 27),
        vibration: round(random.int(8, 28) / 10),
        batteryTemp: round(random.int(220, 390) / 10),
        gpsHdop: round(random.int(7, 16) / 10),
        tetherDescent: round(random.int(18, 32) / 10),
        phase: null,
        lastTelemetryAt: at(base, random.int(0, 12)),
        healthStatus: "Operational",
        policyState: "normal",
        policyRules: [],
        activeFlightCount: 0,
        upcomingFlightCount: 0,
        assignmentConflict: false,
      };
    },
  );

  const dronesBySite = new Map(
    SITES.map((site) => [
      site.id,
      drones.filter((drone) => drone.site === site.id),
    ]),
  );

  const orders: SimulationOrder[] = Array.from(
    { length: orderCount },
    (_, index) => {
      const site = SITES[index % SITES.length];
      const merchant = random.pick(MERCHANTS);
      const siteDrones = dronesBySite.get(site.id) ?? drones;
      const assignedDrone = siteDrones[index % siteDrones.length];
      const requestedMinute = random.int(4, 205);
      const plannedLaunchMinute = requestedMinute + random.int(20, 42);
      const hasReadinessDelay = random.chance(0.24);
      const readinessMinute = hasReadinessDelay
        ? plannedLaunchMinute + random.int(4, 14)
        : requestedMinute + random.int(7, Math.max(8, plannedLaunchMinute - requestedMinute - 5));
      const launchMinute = hasReadinessDelay
        ? readinessMinute + random.int(4, 9)
        : plannedLaunchMinute;
      const flightMinutes = random.int(11, 27);
      const requestedAt = at(base, requestedMinute);
      const launchAt = at(base, launchMinute);
      const deliveredAt = at(base, launchMinute + flightMinutes);
      const promiseMinutes = random.pick([30, 35, 40, 45, 50]);
      const cancelled = random.chance(0.055);
      const elapsed = minutesBetween(deliveredAt, requestedAt);
      const finalStatus = cancelled
        ? "cancelled"
        : elapsed > promiseMinutes
          ? "delivered_late"
          : "delivered";
      const orderId = `ORD-${token}-${String(index + 1).padStart(3, "0")}`;
      const flightId = `FL-${token}-${String(index + 1).padStart(3, "0")}`;
      const readinessLabel = hasReadinessDelay
        ? "Ready after planned departure"
        : "Ready and handoff verified";
      return {
        orderId,
        flightId,
        droneId: assignedDrone.droneId,
        merchantId: merchant.id,
        merchant: merchant.name,
        merchantCategory: merchant.category,
        site: site.id,
        siteLabel: site.label,
        zone: random.pick(site.zones),
        serviceLevel: random.chance(0.28) ? "priority" : "standard",
        promisedMinutes: promiseMinutes,
        requestedAt,
        launchAt,
        deliveredAt: cancelled ? null : deliveredAt,
        minutesToLaunch: launchMinute - requestedMinute,
        status: finalStatus,
        readinessStatus: hasReadinessDelay ? "ready_late" : "ready",
        readinessLabel,
        readinessEventAt: at(base, readinessMinute),
        handoffVerified: true,
        payloadKg: round(random.int(4, 28) / 10),
        distanceKm: round(random.int(12, 86) / 10),
        preflightState: "NO_POLICY_EXCEPTION_DETECTED",
        preflightChecks: [
          { label: "Battery", state: "clear", detail: "Within dispatch limits" },
          { label: "Weather", state: "clear", detail: "Within operating limits" },
          { label: "Payload", state: "clear", detail: "Manifest within limits" },
          {
            label: "Merchant readiness",
            state: "clear",
            detail: readinessLabel,
          },
        ],
      };
    },
  ).sort((left, right) => Date.parse(left.requestedAt) - Date.parse(right.requestedAt));

  const issues: SimulationIssue[] = [];
  const weather: SimulationWeather[] = [];

  for (const site of SITES) {
    weather.push({
      site: site.id,
      siteLabel: site.label,
      wind: random.int(7, 20),
      gust: random.int(12, 27),
      visibility: round(random.int(85, 160) / 10),
      condition: random.chance(0.22) ? "Cloudy" : "Clear",
      policyState: "normal",
      ruleIds: [],
      observedAt: at(base, 0),
      affectedFlights: 0,
    });
  }

  for (const order of orders) {
    if (
      order.readinessStatus !== "ready_late" ||
      order.status === "cancelled" ||
      !order.readinessEventAt
    ) {
      continue;
    }
    const createdAt = new Date(
      Math.min(
        Date.parse(order.readinessEventAt) - 12 * 60_000,
        Date.parse(order.launchAt) - 15 * 60_000,
      ),
    ).toISOString();
    issues.push(
      issue({
        id: `ISS-READY-${order.orderId}`,
        priority: order.serviceLevel === "priority" ? "P1" : "P2",
        category: "Merchant readiness",
        title: `${order.orderId} · Actual readiness missing`,
        summary: "The planned departure cannot proceed until a verified readiness event arrives.",
        entity: order.orderId,
        ruleIds: ["POL-MERCHANT-READY", "POL-HUMAN-DECISION"],
        evidence: [
          evidence(
            `readiness-pending:${order.orderId}`,
            "merchant_readiness_events.csv",
            "Readiness state",
            "No verified ready event at the preflight cutoff",
            createdAt,
          ),
          evidence(
            `flight:${order.flightId}`,
            "commercial_delivery_operations.csv",
            "Planned operation",
            `${order.flightId} assigned to ${order.droneId}`,
            order.launchAt,
          ),
        ],
        allowedActions: [
          "REESTIMATE_PROMISE_FROM_ACTUAL_READY",
          "CUSTOMER_OUTREACH",
          "OPEN_OPERATOR_REVIEW",
        ],
        defaultAction: "REESTIMATE_PROMISE_FROM_ACTUAL_READY",
        createdAt,
        launchBlocking: true,
        effect: "order_readiness_hold",
        clearanceMode: "automatic",
        recoveryAt: order.readinessEventAt,
        recoveryLabel: `Actual readiness confirmed for ${order.orderId}.`,
        recoveryEvidence: [
          evidence(
            `readiness:${order.orderId}`,
            "merchant_readiness_events.csv",
            "Verified readiness event",
            "Ready · handoff verified true",
            order.readinessEventAt,
          ),
        ],
        affectedOrderIds: [order.orderId],
        affectedDroneIds: [order.droneId],
      }),
    );
  }

  const weatherIncidentCount = random.int(1, 2);
  for (const site of random.shuffle(SITES).slice(0, weatherIncidentCount)) {
    const siteOrders = orders.filter(
      (order) => order.site === site.id && order.status !== "cancelled",
    );
    if (!siteOrders.length) continue;
    const anchor = random.pick(siteOrders);
    const anchorLaunchMinute = minutesBetween(anchor.launchAt, at(base, 0));
    const createdMinute = Math.max(18, anchorLaunchMinute - random.int(18, 35));
    const recoveryMinute = Math.min(
      timelineEndMinute - 35,
      createdMinute + random.int(28, 52),
    );
    const createdAt = at(base, createdMinute);
    const recoveryAt = at(base, recoveryMinute);
    const affected = siteOrders.filter((order) => {
      const launch = Date.parse(order.launchAt);
      return launch >= Date.parse(createdAt) && launch <= Date.parse(recoveryAt) + 25 * 60_000;
    });
    if (!affected.includes(anchor)) affected.push(anchor);
    const gust = random.int(48, 68);
    const wind = random.int(31, Math.min(48, gust - 4));
    const visibility = round(random.int(18, 48) / 10);
    const recoveryWind = random.int(8, 18);
    const recoveryGust = random.int(Math.max(14, recoveryWind + 3), 26);
    const recoveryVisibility = round(random.int(90, 150) / 10);
    weather.push(
      {
        site: site.id,
        siteLabel: site.label,
        wind,
        gust,
        visibility,
        condition: random.pick(["High winds", "Thunderstorms", "Heavy rain"]),
        policyState: "hold",
        ruleIds: ["POL-WEATHER-HOLD", "POL-HUMAN-DECISION"],
        observedAt: createdAt,
        affectedFlights: affected.length,
      },
      {
        site: site.id,
        siteLabel: site.label,
        wind: recoveryWind,
        gust: recoveryGust,
        visibility: recoveryVisibility,
        condition: "Clear",
        policyState: "normal",
        ruleIds: [],
        observedAt: recoveryAt,
        affectedFlights: 0,
      },
    );
    issues.push(
      issue({
        id: `ISS-WEATHER-${token}-${site.label.replaceAll(" ", "-").toUpperCase()}`,
        priority: gust >= 60 ? "P0" : "P1",
        category: "Weather",
        title: `${site.label} · Weather hold`,
        summary: `${affected.length} upcoming departure${affected.length === 1 ? "" : "s"} automatically held.`,
        entity: site.label,
        ruleIds: ["POL-WEATHER-HOLD"],
        evidence: [
          evidence(
            `weather:${token}:${site.id}:${createdMinute}`,
            "service_area_weather_hourly.csv",
            "Operating weather",
            `Wind ${wind} kph · Gust ${gust} kph · Visibility ${visibility} km`,
            createdAt,
          ),
        ],
        allowedActions: [
          "HOLD_LAUNCH",
          "DEFER_ORDER",
          "REASSIGN_ORDER",
          "CUSTOMER_OUTREACH",
        ],
        defaultAction: "HOLD_LAUNCH",
        createdAt,
        launchBlocking: true,
        effect: "site_weather_hold",
        clearanceMode: "human_release",
        recoveryAt,
        recoveryLabel: `Weather at ${site.label} returned within operating limits.`,
        recoveryEvidence: [
          evidence(
            `weather-clear:${token}:${site.id}:${recoveryMinute}`,
            "service_area_weather_hourly.csv",
            "Current weather observation",
            `Wind ${recoveryWind} kph (normal <26) · Gust ${recoveryGust} kph (normal <34) · Visibility ${recoveryVisibility} km (normal >7) · Clear`,
            recoveryAt,
          ),
        ],
        affectedOrderIds: affected.map((order) => order.orderId),
        affectedDroneIds: [...new Set(affected.map((order) => order.droneId))],
      }),
    );
  }

  const incidentDrones = random.shuffle(drones);
  const fleetIncidentCount = random.int(1, 2);
  for (let index = 0; index < fleetIncidentCount; index += 1) {
    const drone = incidentDrones[index];
    const relatedOrders = orders.filter(
      (order) => order.droneId === drone.droneId && order.status !== "cancelled",
    );
    if (!relatedOrders.length) continue;
    const anchor = random.pick(relatedOrders);
    const anchorLaunchMinute = minutesBetween(anchor.launchAt, at(base, 0));
    const createdMinute = Math.max(20, anchorLaunchMinute - random.int(16, 32));
    const recoveryMinute = Math.min(
      timelineEndMinute - 25,
      createdMinute + random.int(35, 70),
    );
    const createdAt = at(base, createdMinute);
    const recoveryAt = at(base, recoveryMinute);
    const batteryIncident = index === 0 ? random.chance(0.65) : random.chance(0.45);
    const affected = relatedOrders.filter(
      (order) => Date.parse(order.launchAt) >= Date.parse(createdAt),
    );
    if (!affected.includes(anchor)) affected.push(anchor);
    if (batteryIncident) {
      drone.batteryCapacity = round(random.int(680, 790) / 10);
      drone.cellSpread = random.int(48, 76);
      const recoveredCapacity = random.int(88, 98);
      const recoveredCellSpread = random.int(12, 38);
      const maintenanceCompletedAt = at(base, recoveryMinute - 8);
      const workOrderId = `WO-${token}-${drone.droneId.slice(-3)}-BAT`;
      drone.healthStatus = "Grounded";
      drone.policyState = "ground";
      drone.policyRules = ["POL-FLEET-GROUND"];
      issues.push(
        issue({
          id: `ISS-BATTERY-${token}-${drone.droneId}`,
          priority: "P0",
          category: "Fleet",
          title: `${drone.droneId} · Battery grounding`,
          summary: "Battery health crossed a grounding threshold. New departures are blocked.",
          entity: drone.droneId,
          ruleIds: ["POL-FLEET-GROUND", "POL-NO-AUTHORIZATION"],
          evidence: [
            evidence(
              `health:${token}:${drone.droneId}:${createdMinute}`,
              "drone_health_daily.csv",
              "Battery health",
              `Capacity ${drone.batteryCapacity}% · Cell spread ${drone.cellSpread} mV`,
              createdAt,
            ),
          ],
          allowedActions: [
            "GROUND_AIRCRAFT",
            "REMOVE_INVALID_ASSIGNMENT",
            "OPEN_OPERATOR_REVIEW",
          ],
          defaultAction: "GROUND_AIRCRAFT",
          createdAt,
          launchBlocking: true,
          effect: "aircraft_ground",
          clearanceMode: "human_release",
          recoveryAt,
          recoveryLabel: `Validated maintenance and normal battery health are available for ${drone.droneId}.`,
          recoveryEvidence: [
            evidence(
              `maintenance:${token}:${drone.droneId}`,
              "maintenance_events.csv",
              "Completed maintenance work order",
              `${workOrderId} · Battery pack inspected and load-tested · Technician sign-off: M. Chen · Result: serviceable`,
              maintenanceCompletedAt,
            ),
            evidence(
              `health-clear:${token}:${drone.droneId}`,
              "drone_health_daily.csv",
              "Post-maintenance battery test",
              `Capacity ${recoveredCapacity}% (must be ≥85% to avoid restriction) · Cell spread ${recoveredCellSpread} mV (must be <45 mV to avoid restriction) · Load test passed`,
              recoveryAt,
            ),
          ],
          affectedOrderIds: affected.map((order) => order.orderId),
          affectedDroneIds: [drone.droneId],
        }),
      );
    } else {
      drone.vibration = round(random.int(22, 30) / 10);
      const recoveredVibration = round(random.int(11, 19) / 10);
      const maintenanceCompletedAt = at(base, recoveryMinute - 6);
      const workOrderId = `WO-${token}-${drone.droneId.slice(-3)}-MTR`;
      drone.healthStatus = "Restricted";
      drone.policyState = "restrict";
      drone.policyRules = ["POL-FLEET-RESTRICT"];
      issues.push(
        issue({
          id: `ISS-VIBRATION-${token}-${drone.droneId}`,
          priority: "P1",
          category: "Fleet",
          title: `${drone.droneId} · Motor vibration restriction`,
          summary: "Motor vibration requires maintenance review before another departure.",
          entity: drone.droneId,
          ruleIds: ["POL-FLEET-RESTRICT", "POL-NO-AUTHORIZATION"],
          evidence: [
            evidence(
              `health:${token}:${drone.droneId}:${createdMinute}`,
              "drone_health_daily.csv",
              "Motor health",
              `Motor vibration ${drone.vibration} mm/s`,
              createdAt,
            ),
          ],
          allowedActions: [
            "RESTRICT_AND_OPEN_MAINTENANCE_REVIEW",
            "OPEN_OPERATOR_REVIEW",
          ],
          defaultAction: "RESTRICT_AND_OPEN_MAINTENANCE_REVIEW",
          createdAt,
          launchBlocking: true,
          effect: "aircraft_restrict",
          clearanceMode: "human_release",
          recoveryAt,
          recoveryLabel: `Validated maintenance and normal vibration are available for ${drone.droneId}.`,
          recoveryEvidence: [
            evidence(
              `maintenance:${token}:${drone.droneId}`,
              "maintenance_events.csv",
              "Completed maintenance work order",
              `${workOrderId} · Motor mount inspected and fasteners re-torqued · Technician sign-off: A. Rivera · Result: serviceable`,
              maintenanceCompletedAt,
            ),
            evidence(
              `health-clear:${token}:${drone.droneId}`,
              "flight_telemetry_phases.csv",
              "Post-maintenance vibration test",
              `Motor vibration ${recoveredVibration} mm/s (must be <2.2 mm/s to avoid restriction) · Ground-run test passed`,
              recoveryAt,
            ),
          ],
          affectedOrderIds: affected.map((order) => order.orderId),
          affectedDroneIds: [drone.droneId],
        }),
      );
    }
  }

  if (random.chance(0.72)) {
    const candidates = orders.filter(
      (order) => order.status !== "cancelled" && Date.parse(order.launchAt) > Date.parse(at(base, 45)),
    );
    if (candidates.length >= 2) {
      const first = random.pick(candidates);
      const second =
        candidates.find(
          (order) =>
            order.orderId !== first.orderId &&
            order.site === first.site &&
            Math.abs(Date.parse(order.launchAt) - Date.parse(first.launchAt)) <= 40 * 60_000,
        );
      if (second) {
        second.droneId = first.droneId;
        const createdAt = new Date(
          Math.min(Date.parse(first.launchAt), Date.parse(second.launchAt)) - 18 * 60_000,
        ).toISOString();
        const drone = drones.find((item) => item.droneId === first.droneId);
        if (drone) drone.assignmentConflict = true;
        issues.push(
          issue({
            id: `ISS-ASSIGNMENT-${token}-${first.droneId}`,
            priority: "P1",
            category: "Assignment",
            title: `${first.droneId} · Overlapping assignments`,
            summary: "Two operations claim the same aircraft in an overlapping dispatch window.",
            entity: first.droneId,
            ruleIds: ["POL-ONE-ACTIVE-ASSIGNMENT"],
            evidence: [
              evidence(
                `assignment:${token}:${first.droneId}`,
                "commercial_delivery_operations.csv",
                "Conflicting assignments",
                `${first.flightId} and ${second.flightId}`,
                createdAt,
              ),
            ],
            allowedActions: ["OPEN_OPERATOR_REVIEW", "REMOVE_INVALID_ASSIGNMENT"],
            defaultAction: "OPEN_OPERATOR_REVIEW",
            createdAt,
            launchBlocking: true,
            effect: "assignment_conflict",
            clearanceMode: "manual_resolution",
            recoveryAt: null,
            recoveryLabel: null,
            affectedOrderIds: [first.orderId, second.orderId],
            affectedDroneIds: [first.droneId],
          }),
        );
      }
    }
  }

  if (random.chance(0.58)) {
    const merchant = random.pick(MERCHANTS);
    const merchantOrders = orders.filter((order) => order.merchantId === merchant.id);
    if (merchantOrders.length) {
      const createdAt =
        merchantOrders.at(-1)?.readinessEventAt ?? at(base, random.int(130, 210));
      issues.push(
        issue({
          id: `ISS-MERCHANT-${token}-${merchant.id}`,
          priority: "P3",
          category: "Merchant readiness",
          title: `${merchant.name} · Readiness delay pattern`,
          summary: "Recent generated orders show repeated readiness delays. This is advisory only.",
          entity: merchant.name,
          ruleIds: ["POL-MERCHANT-READY"],
          evidence: [
            evidence(
              `merchant-pattern:${token}:${merchant.id}`,
              "merchant_readiness_events.csv",
              "Readiness pattern",
              `${merchantOrders.length} orders in the current simulation`,
              createdAt,
            ),
          ],
          allowedActions: [
            "OPEN_OPERATOR_REVIEW",
            "REESTIMATE_PROMISE_FROM_ACTUAL_READY",
          ],
          defaultAction: "OPEN_OPERATOR_REVIEW",
          createdAt,
          launchBlocking: false,
          effect: "advisory",
          clearanceMode: "manual_resolution",
          recoveryAt: null,
          recoveryLabel: null,
          affectedOrderIds: merchantOrders.map((order) => order.orderId),
          affectedDroneIds: [],
        }),
      );
    }
  }

  weather.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  issues.sort(
    (left, right) =>
      PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
      Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );

  for (const drone of drones) {
    const droneOrders = orders.filter((order) => order.droneId === drone.droneId);
    const nextOrder = droneOrders[0];
    if (nextOrder) {
      drone.flightId = nextOrder.flightId;
      drone.orderId = nextOrder.orderId;
      drone.phase = "preflight";
      drone.lastTelemetryAt = nextOrder.requestedAt;
    }
  }

  return validateSimulation({
    id: runId,
    runId,
    seed: normalizedSeed,
    label: "Generated operations simulation",
    description: "",
    now: at(base, timelineEndMinute),
    timelineStart: at(base, 0),
    timelineEnd: at(base, timelineEndMinute),
    generatedFrom: GENERATED_FROM,
    summary: {
      airborne: 0,
      preflight: 0,
      grounded: 0,
      conflicts: issues.filter((item) => item.effect === "assignment_conflict").length,
      openIssues: issues.length,
      criticalIssues: issues.filter((item) => item.priority === "P0").length,
    },
    weather,
    drones,
    orders,
    issues,
  });
}
