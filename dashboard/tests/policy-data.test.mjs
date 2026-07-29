import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const payload = JSON.parse(
  await readFile(
    new URL("../app/data/live-scenarios.json", import.meta.url),
    "utf8",
  ),
);

const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };

test("every replay scenario has complete fleet state and time-safe evidence", () => {
  for (const scenario of payload.scenarios) {
    assert.equal(scenario.drones.length, 24);

    for (const drone of scenario.drones) {
      if (drone.lastTelemetryAt) {
        assert.ok(
          new Date(drone.lastTelemetryAt) <= new Date(scenario.now),
          `${drone.droneId} uses future telemetry`,
        );
      }
    }

    for (const order of scenario.orders) {
      if (order.readinessEventAt) {
        assert.ok(
          new Date(order.readinessEventAt) <= new Date(scenario.now),
          `${order.orderId} uses a future readiness event`,
        );
      }
    }
  }
});

test("issues are priority-sorted and always require a human decision", () => {
  for (const scenario of payload.scenarios) {
    const ranks = scenario.issues.map((issue) => priorityRank[issue.priority]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.ok(scenario.issues.every((issue) => issue.humanDecisionRequired));
  }
});

test("known incident regressions use measured policy evidence", () => {
  const battery = payload.scenarios.find(
    (scenario) => scenario.id === "battery-grounding",
  );
  const batteryIssue = battery.issues.find((issue) =>
    issue.title.includes("ZIP-US-011"),
  );
  assert.equal(batteryIssue.priority, "P0");
  assert.ok(batteryIssue.ruleIds.includes("FLEET_GROUND_CAPACITY"));
  assert.ok(batteryIssue.ruleIds.includes("FLEET_GROUND_SPREAD"));
  assert.equal(batteryIssue.allowedActions[0], "GROUND_AIRCRAFT");

  const weather = payload.scenarios.find(
    (scenario) => scenario.id === "eastside-weather",
  );
  const weatherIssue = weather.issues.find((issue) =>
    issue.title.includes("Hold threshold"),
  );
  assert.equal(weatherIssue.priority, "P0");
  assert.deepEqual(weatherIssue.ruleIds, ["WX_HOLD_GUST"]);
  assert.match(weatherIssue.evidence[0].value, /Gust 46\.0 kph/);

  const tether = payload.scenarios.find(
    (scenario) => scenario.id === "tether-variance",
  );
  const tetherIssue = tether.issues.find((issue) =>
    issue.title.includes("Tether descent variance"),
  );
  assert.equal(tetherIssue.priority, "P2");
  assert.deepEqual(tetherIssue.ruleIds, ["HISTORICAL_TETHER_PATTERN"]);
  assert.equal("recommendation" in tetherIssue, false);
});

test("preflight states never claim authorization", () => {
  const prohibited = /PASS|SAFE|AUTHORIZED|CLEARED/i;
  for (const scenario of payload.scenarios) {
    for (const order of scenario.orders) {
      assert.doesNotMatch(order.preflightState ?? "", prohibited);
    }
    assert.ok(
      scenario.issues.every((issue) => !("recommendation" in issue)),
      "Dataset issues must not contain placeholder AI recommendations",
    );
  }
});
