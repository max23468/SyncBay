import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { runDueSyncJobs } from "../services/sync-job-runner.server";
import {
  getSyncBayRequestId,
  getSyncBayRunnerCompletionLevel,
  logSyncBayRuntimeEvent,
} from "../lib/syncbay-runtime-log";

export const action = async ({ request, url }: ActionFunctionArgs) => {
  requireCronSecret(request);
  const startedAt = performance.now();
  const requestId = getSyncBayRequestId(request);

  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const deadlineAt = new Date(Date.now() + 70_000);
  let result;
  try {
    result = await runDueSyncJobs({
      deadlineAt,
      limit: Number.isInteger(limit) ? limit : undefined,
    });
  } catch (error) {
    logSyncBayRuntimeEvent({ event: "syncbay-runner-completed", level: "error", requestId, route: "api.jobs.run-due", elapsedMs: Math.round(performance.now() - startedAt), outcome: "failed" });
    throw error;
  }

  logSyncBayRuntimeEvent({
    event: "syncbay-runner-completed",
    level: getSyncBayRunnerCompletionLevel(result.failedCount),
    requestId,
    route: "api.jobs.run-due",
    elapsedMs: Math.round(performance.now() - startedAt),
    processedCount: result.processedCount,
    failedCount: result.failedCount,
    continuationNeeded: result.continuationNeeded,
    outcome: result.failedCount > 0 ? "partial" : "ok",
  });

  return Response.json(result);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireCronSecret(request);

  return Response.json({
    endpoint: "syncbay-run-due-jobs",
    method: "POST",
    status: "ready",
  });
};

function requireCronSecret(request: Request) {
  const expectedSecret = process.env.CRON_SECRET?.trim();

  if (!expectedSecret) {
    throw new Response("CRON_SECRET non configurato.", { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerSecret = request.headers.get("x-syncbay-cron-secret")?.trim();

  if (bearer === expectedSecret || headerSecret === expectedSecret) {
    return;
  }

  throw new Response("Non autorizzato.", { status: 401 });
}
