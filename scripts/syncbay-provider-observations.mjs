import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERCEL_ANALYTICS_LIMIT = 50_000;
const VERCEL_SPEED_INSIGHTS_LIMIT = 10_000;
const SPEED_INSIGHTS_METRICS = ["cls", "fcp", "inp", "lcp", "ttfb"];

export async function observeVercel({ cwd = process.cwd(), env = process.env, execute = executeCommand } = {}) {
  const link = await readVercelLink(cwd);
  const teamsResult = await execute("vercel", ["api", "/v2/teams", "--raw"], { cwd, env });
  const teams = teamsResult.ok ? parseJson(teamsResult.stdout) : null;
  const team = selectVercelTeam(teams, link?.orgId);
  const declaredPlan = normalizeDeclaredPlan(env.VERCEL_PLAN);
  const observedPlan = normalizePlan(team?.billing?.plan ?? team?.plan);
  const plan = observedPlan ?? declaredPlan;
  const scope = team?.slug;
  const project = link?.projectName ?? link?.projectId ?? env.VERCEL_PROJECT_ID?.trim() ?? undefined;
  const speedWindowDays = plan === "hobby" ? 7 : 30;

  const planObservation = observedPlan
    ? {
        status: "observed",
        value: observedPlan,
        source: "vercel_api",
        ...(declaredPlan && declaredPlan !== observedPlan
          ? { declarationDrift: { declared: declaredPlan, observed: observedPlan } }
          : {}),
      }
    : declaredPlan
      ? { status: "declared", value: declaredPlan, source: "VERCEL_PLAN" }
      : { status: "unavailable", action: "authenticate_vercel_cli_or_set_VERCEL_PLAN" };

  if (!scope) {
    return {
      plan: plan ?? null,
      planObservation,
      usage: { status: "unavailable", action: "authenticate_vercel_cli" },
      analytics: { status: "unavailable", action: "authenticate_vercel_cli" },
      speedInsights: { status: "unavailable", action: "authenticate_vercel_cli" },
      fastDataTransfer: { status: "unavailable", action: "authenticate_vercel_cli" },
      runtimeMetrics: { status: "unavailable", action: "authenticate_vercel_cli" },
    };
  }

  const common = ["--scope", scope, "--format", "json"];
  const analyticsPromise = execute(
    "vercel",
    ["metrics", "vercel.analytics_pageview.count", "--all", "--since", "30d", "--prod", ...common],
    { cwd, env },
  );
  const speedPromises = SPEED_INSIGHTS_METRICS.map((metric) =>
    execute(
      "vercel",
      [
        "metrics",
        `vercel.speed_insights.${metric}_count`,
        "--since",
        `${speedWindowDays}d`,
        "--prod",
        ...(project ? ["--project", project] : []),
        ...common,
      ],
      { cwd, env },
    ),
  );
  const transferPromise = execute(
    "vercel",
    ["metrics", "vercel.request.fdt_out_bytes", "--all", "--since", "30d", "--prod", ...common],
    { cwd, env },
  );
  const runtimePromise = execute(
    "vercel",
    ["metrics", "vercel.function_invocation.count", "--all", "--since", "30d", "--prod", ...common],
    { cwd, env },
  );
  const usagePromise = execute("vercel", ["usage", "--format", "json", "--scope", scope], { cwd, env });

  const [analyticsResult, speedResults, transferResult, runtimeResult, usageResult] = await Promise.all([
    analyticsPromise,
    Promise.all(speedPromises),
    transferPromise,
    runtimePromise,
    usagePromise,
  ]);

  return {
    plan: plan ?? null,
    planObservation,
    usage: buildVercelUsageObservation(usageResult, plan),
    analytics: buildMetricObservation(analyticsResult, {
      limit: VERCEL_ANALYTICS_LIMIT,
      scope: "team",
      windowDays: 30,
    }),
    speedInsights: buildSpeedInsightsObservation(speedResults, {
      limit: VERCEL_SPEED_INSIGHTS_LIMIT,
      partial: speedWindowDays < 30,
      projectScoped: Boolean(project),
      windowDays: speedWindowDays,
    }),
    fastDataTransfer: buildLockedMetricObservation(transferResult, {
      action: "verify_vercel_usage_dashboard",
      quota: plan === "hobby" ? { value: 1_000_000_000_000, unit: "bytes", label: "1 TB per 30 giorni" } : undefined,
    }),
    runtimeMetrics: buildLockedMetricObservation(runtimeResult, {
      action: "verify_vercel_usage_dashboard",
      quota: plan === "hobby" ? { value: 1_000_000, unit: "invocations", label: "1.000.000 per 30 giorni" } : undefined,
    }),
  };
}

export function buildPlanEligibility({ commercialUse, plan }) {
  if (plan === "hobby" && commercialUse.value === true) return "blocked";
  if (!plan) return "requires_plan_observation";
  if (commercialUse.status === "defaulted_private") return "ok_private_only";
  return "ok";
}

export function observeCommercialUse(rawValue) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (normalized === "true") return { status: "declared", value: true };
  if (normalized === "false") return { status: "declared", value: false };
  return { status: "defaulted_private", value: false, action: "set_SYNCBAY_COMMERCIAL_USE_before_onboarding" };
}

export function buildSupabaseStorageObservation({ bytes, objectCount, quotaBytes = 1_000_000_000 }) {
  const normalizedBytes = Number.isFinite(Number(bytes)) && Number(bytes) > 0 ? Number(bytes) : 0;
  const normalizedObjects = Number.isFinite(Number(objectCount)) && Number(objectCount) > 0 ? Math.trunc(Number(objectCount)) : 0;
  const utilization = quotaBytes > 0 ? normalizedBytes / quotaBytes : 0;
  const status = utilization >= 0.95 ? "blocked" : utilization >= 0.85 ? "urgent" : utilization >= 0.7 ? "warning" : "ok";
  return {
    status,
    source: "storage.objects",
    measurement: "live_object_bytes",
    bytes: normalizedBytes,
    objectCount: normalizedObjects,
    quotaBytes,
    utilization: Math.round(utilization * 100_000) / 100_000,
    billingCaveat: "dashboard_uses_average_gb_hours",
  };
}

export function selectVercelTeam(payload, orgId) {
  const teams = Array.isArray(payload?.teams) ? payload.teams : Array.isArray(payload) ? payload : [];
  if (orgId) return teams.find((team) => team.id === orgId) ?? null;
  return teams.length === 1 ? teams[0] : null;
}

export function metricTotal(payload) {
  const summaries = Array.isArray(payload?.summary) ? payload.summary : [];
  return summaries.reduce(
    (total, summary) =>
      total +
      Object.entries(summary ?? {}).reduce(
        (rowTotal, [key, value]) => rowTotal + (key.endsWith("_sum") && Number.isFinite(Number(value)) ? Number(value) : 0),
        0,
      ),
    0,
  );
}

export function buildMetricObservation(result, { limit, scope, windowDays }) {
  if (!result.ok) return classifyMetricFailure(result, "verify_vercel_dashboard");
  const payload = parseJson(result.stdout);
  if (!payload) return { status: "unavailable", reason: "invalid_cli_json", action: "verify_vercel_dashboard" };
  const value = metricTotal(payload);
  return {
    status: "observed",
    source: "vercel_metrics",
    scope,
    windowDays,
    value,
    limit,
    utilization: ratio(value, limit),
    budgetStatus: classifyUtilization(value, limit),
  };
}

export function buildSpeedInsightsObservation(results, { limit, partial, projectScoped, windowDays }) {
  const observations = results.map((result) => buildMetricObservation(result, { limit, scope: "project", windowDays }));
  const failure = observations.find((observation) => observation.status !== "observed");
  if (failure) return failure;
  const value = observations.reduce((total, observation) => total + observation.value, 0);
  return {
    status: partial ? "partial" : "observed",
    ...(partial ? { reason: "hobby_retention_7d" } : {}),
    source: "vercel_metrics",
    scope: projectScoped ? "project" : "current_scope",
    windowDays,
    value,
    limit,
    utilization: ratio(value, limit),
    ...(partial
      ? {
          observedBudgetStatus: classifyUtilization(value, limit),
          action: "verify_full_30d_usage_in_vercel_dashboard",
        }
      : { budgetStatus: classifyUtilization(value, limit) }),
  };
}

export function buildVercelUsageObservation(result, plan) {
  if (result.ok) {
    const payload = parseJson(result.stdout);
    return payload
      ? { status: "observed", source: "vercel_usage", period: payload.period ?? null, totals: payload.totals ?? payload.grandTotal ?? null }
      : { status: "unavailable", reason: "invalid_cli_json", action: "verify_vercel_usage_dashboard" };
  }
  const error = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/costs not found|\b404\b/i.test(error) && plan === "hobby") {
    return {
      status: "not_applicable",
      reason: "hobby_has_no_billing_cycle",
      action: "use_observed_metrics_and_vercel_usage_dashboard",
    };
  }
  return { status: "unavailable", reason: safeFailureReason(error), action: "verify_vercel_usage_dashboard" };
}

export function buildLockedMetricObservation(result, { action, quota } = {}) {
  if (result.ok) {
    const payload = parseJson(result.stdout);
    const value = payload ? metricTotal(payload) : null;
    return value === null
      ? { status: "unavailable", reason: "invalid_cli_json", action }
      : {
          status: "observed",
          source: "vercel_metrics",
          windowDays: 30,
          value,
          ...(quota
            ? {
                quota,
                utilization: ratio(value, quota.value),
                budgetStatus: classifyUtilization(value, quota.value),
              }
            : {}),
        };
  }
  const error = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/observability plus|payment_required/i.test(error)) {
    return { status: "provider_locked", reason: "observability_plus_required", action, ...(quota ? { quota } : {}) };
  }
  return { status: "unavailable", reason: safeFailureReason(error), action, ...(quota ? { quota } : {}) };
}

async function readVercelLink(cwd) {
  const candidates = [path.join(cwd, ".vercel", "project.json")];
  const gitResult = await executeCommand("git", ["rev-parse", "--git-common-dir"], { cwd, env: process.env });
  if (gitResult.ok) {
    const commonDir = path.resolve(cwd, gitResult.stdout.trim());
    candidates.push(path.join(path.dirname(commonDir), ".vercel", "project.json"));
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(await fs.readFile(candidate, "utf8"));
    } catch {
      // Prova il link della worktree principale o il fallback dichiarativo.
    }
  }
  return null;
}

async function executeCommand(command, args, { cwd, env }) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env,
      maxBuffer: 5 * 1024 * 1024,
      timeout: 60_000,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? ""),
    };
  }
}

function classifyMetricFailure(result, action) {
  const error = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/observability plus|payment_required/i.test(error)) {
    return { status: "provider_locked", reason: "observability_plus_required", action };
  }
  if (/latest 7 days|hobby plan/i.test(error)) {
    return { status: "partial", reason: "hobby_retention_limit", action };
  }
  return { status: "unavailable", reason: safeFailureReason(error), action };
}

function normalizeDeclaredPlan(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized && !["auto", "unknown"].includes(normalized) ? normalized : null;
}

function normalizePlan(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function parseJson(value) {
  try {
    return JSON.parse(String(value).trim());
  } catch {
    return null;
  }
}

function ratio(value, limit) {
  return limit > 0 ? Math.round((value / limit) * 100_000) / 100_000 : null;
}

function classifyUtilization(value, limit) {
  const utilization = limit > 0 ? value / limit : 0;
  if (utilization >= 0.95) return "blocked";
  if (utilization >= 0.85) return "urgent";
  if (utilization >= 0.7) return "warning";
  return "ok";
}

function safeFailureReason(value) {
  if (/not found|enoent/i.test(value)) return "cli_not_installed";
  if (/unauthorized|login|authentication/i.test(value)) return "authentication_required";
  if (/timeout/i.test(value)) return "timeout";
  return "cli_query_failed";
}
