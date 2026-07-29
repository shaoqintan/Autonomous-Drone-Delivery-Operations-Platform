import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile(
  new URL("../app/operations-dashboard.tsx", import.meta.url),
  "utf8",
);

test("dashboard uses one event replay with actual order timestamps", () => {
  assert.match(dashboardSource, /Fleet status/i);
  assert.match(dashboardSource, /createUnifiedScenario/i);
  assert.match(dashboardSource, /replayEvents/i);
  assert.match(dashboardSource, /order\.requestedAt/i);
  assert.match(dashboardSource, /1×/i);
  assert.match(dashboardSource, /Replay timeline/i);
  assert.match(dashboardSource, /setInterval/);
  assert.doesNotMatch(dashboardSource, /Replay scenario/i);
  assert.doesNotMatch(dashboardSource, /Advance replay/i);
  assert.doesNotMatch(dashboardSource, /Every aircraft, one live view/i);
  assert.doesNotMatch(dashboardSource, /Promise, readiness, departure/i);
  assert.doesNotMatch(dashboardSource, /Resolve the highest-risk issue first/i);
  assert.doesNotMatch(dashboardSource, /codex-preview/i);
  assert.doesNotMatch(dashboardSource, /Your site is taking shape/i);
});

test("issue workflow keeps immediate recommendations, kanban, and chat concise", () => {
  assert.match(dashboardSource, /Recommendation/i);
  assert.match(dashboardSource, /In progress/i);
  assert.match(dashboardSource, /Waiting/i);
  assert.match(dashboardSource, /Resolved/i);
  assert.match(dashboardSource, /Issue chat/i);
  assert.doesNotMatch(dashboardSource, /Generate recommendation/i);
  assert.doesNotMatch(dashboardSource, /Issue command board/i);
  assert.doesNotMatch(dashboardSource, /Recommended on arrival/i);
  assert.doesNotMatch(dashboardSource, /Ticket stays open until a human resolves it/i);
});
