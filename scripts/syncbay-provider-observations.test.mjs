import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLockedMetricObservation,
  buildMetricObservation,
  buildPlanEligibility,
  buildSupabaseStorageObservation,
  buildSpeedInsightsObservation,
  buildVercelUsageObservation,
  metricTotal,
  observeCommercialUse,
  selectVercelTeam,
} from "./syncbay-provider-observations.mjs";

const metricResult = (value) => ({
  ok: true,
  stdout: JSON.stringify({ summary: [{ arbitrary_metric_sum: value }] }),
  stderr: "",
});

test("selects the linked Vercel team and reads its billing plan", () => {
  const team = selectVercelTeam(
    { teams: [{ id: "team_other" }, { id: "team_syncbay", billing: { plan: "hobby" } }] },
    "team_syncbay",
  );
  assert.equal(team.billing.plan, "hobby");
});

test("sums only metric summary values", () => {
  assert.equal(metricTotal({ summary: [{ first_sum: 12, ignored_avg: 99 }, { second_sum: 3 }] }), 15);
});

test("reports observed analytics against the team quota", () => {
  assert.deepEqual(buildMetricObservation(metricResult(250), { limit: 50_000, scope: "team", windowDays: 30 }), {
    status: "observed",
    source: "vercel_metrics",
    scope: "team",
    windowDays: 30,
    value: 250,
    limit: 50_000,
    utilization: 0.005,
    budgetStatus: "ok",
  });
});

test("keeps Speed Insights explicitly partial on Hobby retention", () => {
  const observation = buildSpeedInsightsObservation(
    [metricResult(1), metricResult(2), metricResult(0), metricResult(2), metricResult(2)],
    { limit: 10_000, partial: true, projectScoped: true, windowDays: 7 },
  );
  assert.equal(observation.status, "partial");
  assert.equal(observation.value, 7);
  assert.equal(observation.windowDays, 7);
  assert.equal(observation.utilization, 0.0007);
  assert.equal(observation.observedBudgetStatus, "ok");
});

test("classifies Observability Plus metrics as provider locked", () => {
  assert.deepEqual(
    buildLockedMetricObservation(
      { ok: false, stderr: "payment_required: Observability Plus is required", stdout: "" },
      { action: "verify_dashboard" },
    ),
    {
      status: "provider_locked",
      reason: "observability_plus_required",
      action: "verify_dashboard",
    },
  );
});

test("classifies missing Hobby costs as not applicable instead of unknown", () => {
  assert.deepEqual(
    buildVercelUsageObservation({ ok: false, stderr: "Error: Costs not found (404)", stdout: "" }, "hobby"),
    {
      status: "not_applicable",
      reason: "hobby_has_no_billing_cycle",
      action: "use_observed_metrics_and_vercel_usage_dashboard",
    },
  );
});

test("defaults undeclared commercial use to private-only and keeps it actionable", () => {
  const commercialUse = observeCommercialUse(undefined);
  assert.equal(commercialUse.status, "defaulted_private");
  assert.equal(buildPlanEligibility({ commercialUse, plan: "hobby" }), "ok_private_only");
});

test("blocks declared commercial use on Vercel Hobby", () => {
  const commercialUse = observeCommercialUse("true");
  assert.equal(buildPlanEligibility({ commercialUse, plan: "hobby" }), "blocked");
});

test("classifies live Supabase Storage bytes against the Free quota", () => {
  assert.equal(buildSupabaseStorageObservation({ bytes: 699_999_999, objectCount: 4 }).status, "ok");
  assert.equal(buildSupabaseStorageObservation({ bytes: 700_000_000, objectCount: 4 }).status, "warning");
  assert.equal(buildSupabaseStorageObservation({ bytes: 850_000_000, objectCount: 4 }).status, "urgent");
  assert.equal(buildSupabaseStorageObservation({ bytes: 950_000_000, objectCount: 4 }).status, "blocked");
});
