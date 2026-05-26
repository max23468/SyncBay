import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { runDueSyncJobs } from "../services/sync-job-runner.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  requireCronSecret(request);

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const result = await runDueSyncJobs({
    limit: Number.isInteger(limit) ? limit : undefined,
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
