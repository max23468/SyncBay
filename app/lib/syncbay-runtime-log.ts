import { randomUUID } from "node:crypto";

export type RuntimeLogEvent = {
  event: string;
  level: "info" | "warn" | "error";
  requestId: string | null;
  route: string;
  shopDomain?: string;
  durationMs?: number;
  payloadBytes?: number | null;
  outcome?: string;
  processedCount?: number;
  failedCount?: number;
  elapsedMs?: number;
  continuationNeeded?: boolean;
};

const HEALTHY_SAMPLE_RATE = 0.05;
const SLOW_REQUEST_MS = 1_000;

export function getSyncBayRunnerCompletionLevel(failedCount: number): RuntimeLogEvent["level"] {
  return failedCount > 0 ? "warn" : "info";
}

export function getSyncBayRequestId(request?: Request) {
  const vercelId = request?.headers.get("x-vercel-id")?.slice(0, 128);
  return vercelId && /^[a-zA-Z0-9:._-]+$/u.test(vercelId) ? vercelId : randomUUID();
}

export function shouldLogSyncBayRuntimeEvent(
  event: RuntimeLogEvent,
  random: () => number = Math.random,
) {
  if (process.env.NODE_ENV !== "production") return true;
  if (event.level !== "info") return true;
  if ((event.durationMs ?? event.elapsedMs ?? 0) > SLOW_REQUEST_MS) return true;
  return random() < HEALTHY_SAMPLE_RATE;
}

export function logSyncBayRuntimeEvent(
  event: RuntimeLogEvent,
  options: { random?: () => number } = {},
) {
  if (!shouldLogSyncBayRuntimeEvent(event, options.random)) return false;

  const line = JSON.stringify({
    event: event.event,
    level: event.level,
    requestId: event.requestId,
    route: event.route,
    ...(event.shopDomain === undefined ? {} : { shopDomain: event.shopDomain }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.payloadBytes === undefined ? {} : { payloadBytes: event.payloadBytes }),
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
    ...(event.processedCount === undefined ? {} : { processedCount: event.processedCount }),
    ...(event.failedCount === undefined ? {} : { failedCount: event.failedCount }),
    ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
    ...(event.continuationNeeded === undefined
      ? {}
      : { continuationNeeded: event.continuationNeeded }),
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? null,
      vercelRegion: process.env.VERCEL_REGION ?? null,
    },
  });

  if (event.level === "error") console.error(line);
  else if (event.level === "warn") console.warn(line);
  else console.info(line);
  return true;
}
