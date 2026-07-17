import {
  getSyncBayRequestId,
  logSyncBayRuntimeEvent,
} from "./syncbay-runtime-log.ts";

export type SyncBayLoaderRoute =
  "activity" | "catalog" | "conflicts" | "import" | "overview" | "settings";

export type SyncBayLoaderPerformanceMetric = {
  durationMs: number;
  label: string;
};

export type SyncBayLoaderPerformanceTrace = {
  measure: <T>(label: string, callback: () => Promise<T>) => Promise<T>;
  metrics: () => SyncBayLoaderPerformanceMetric[];
  startedAt: number;
};

export const SYNCBAY_LOADER_PAYLOAD_BUDGETS = {
  activity: 128 * 1024,
  catalog: 256 * 1024,
  conflicts: 256 * 1024,
  import: 256 * 1024,
  overview: 128 * 1024,
  settings: 128 * 1024,
} satisfies Record<SyncBayLoaderRoute, number>;

type SyncBayLoaderPerformanceDetails = Record<
  string,
  boolean | number | string | null
>;

export function createSyncBayLoaderPerformanceTrace(): SyncBayLoaderPerformanceTrace {
  const metrics: SyncBayLoaderPerformanceMetric[] = [];

  return {
    async measure<T>(label: string, callback: () => Promise<T>) {
      const startedAt = performance.now();

      try {
        return await callback();
      } finally {
        metrics.push({
          durationMs: roundDurationMs(performance.now() - startedAt),
          label,
        });
      }
    },
    metrics: () => [...metrics],
    startedAt: performance.now(),
  };
}

export async function measureSyncBayPerformanceStage<T>(
  trace: SyncBayLoaderPerformanceTrace | undefined,
  label: string,
  callback: () => Promise<T>,
) {
  return trace ? trace.measure(label, callback) : callback();
}

export function logSyncBayLoaderPerformance(input: {
  details?: SyncBayLoaderPerformanceDetails;
  payload: unknown;
  route: SyncBayLoaderRoute;
  trace: SyncBayLoaderPerformanceTrace;
  requestId?: string | null;
  request?: Request;
}) {
  if (process.env.SYNCBAY_LOADER_PERFORMANCE_LOGS === "off") return;

  const payloadBytes = getJsonPayloadBytes(input.payload);
  const totalMs = roundDurationMs(performance.now() - input.trace.startedAt);

  const budget = SYNCBAY_LOADER_PAYLOAD_BUDGETS[input.route];
  const ratio = payloadBytes === null ? 0 : payloadBytes / budget;
  const level = ratio > 1 ? "error" : ratio >= 0.8 ? "warn" : "info";

  logSyncBayRuntimeEvent({
    event: "syncbay-loader-performance",
    level,
    outcome:
      ratio > 1
        ? "payload_budget_exceeded"
        : ratio >= 0.8
          ? "payload_budget_warning"
          : "ok",
    payloadBytes,
    requestId:
      input.requestId ??
      (input.request ? getSyncBayRequestId(input.request) : null),
    route: input.route,
    durationMs: totalMs,
  });

  return { budget, level, payloadBytes, totalMs };
}

export function assertSyncBayLoaderPayloadBudget(
  route: SyncBayLoaderRoute,
  payload: unknown,
) {
  const payloadBytes = getJsonPayloadBytes(payload);
  const budget = SYNCBAY_LOADER_PAYLOAD_BUDGETS[route];
  if (payloadBytes !== null && payloadBytes > budget) {
    throw new Error(
      `Payload ${route} oltre budget: ${payloadBytes}/${budget} byte.`,
    );
  }
  return payloadBytes;
}

function getJsonPayloadBytes(payload: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return null;
  }
}

function roundDurationMs(value: number) {
  return Math.round(value * 10) / 10;
}
