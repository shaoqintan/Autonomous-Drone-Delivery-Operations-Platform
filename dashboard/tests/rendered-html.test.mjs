import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile(
  new URL("../app/operations-dashboard.tsx", import.meta.url),
  "utf8",
);

test("dashboard exposes continuous replay controls", () => {
  assert.match(dashboardSource, /Fleet status/i);
  assert.match(dashboardSource, /Human decision required/i);
  assert.match(dashboardSource, /5 min\/sec/i);
  assert.match(dashboardSource, /Replay timeline/i);
  assert.match(dashboardSource, /setInterval/);
  assert.doesNotMatch(dashboardSource, /Advance replay/i);
  assert.doesNotMatch(dashboardSource, /Every aircraft, one live view/i);
  assert.doesNotMatch(dashboardSource, /Promise, readiness, departure/i);
  assert.doesNotMatch(dashboardSource, /Resolve the highest-risk issue first/i);
  assert.doesNotMatch(dashboardSource, /codex-preview/i);
  assert.doesNotMatch(dashboardSource, /Your site is taking shape/i);
});
