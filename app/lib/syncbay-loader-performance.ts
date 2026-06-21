export type SyncBayLoaderRoute =
  | "activity"
  | "catalog"
  | "conflicts"
  | "import"
  | "overview"
  | "settings";

export type SyncBayLoaderPerformanceMetric = {
  durationMs: number;
  label: string;
};

export type SyncBayLoaderPerformanceTrace = {
  measure: <T>(label: string, callback: () => Promise<T>) => Promise<T>;
  metrics: () => SyncBayLoaderPerformanceMetric[];
  startedAt: number;
};

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
}) {
  if (process.env.SYNCBAY_LOADER_PERFORMANCE_LOGS === "off") return;

  const payloadBytes = getJsonPayloadBytes(input.payload);
  const totalMs = roundDurationMs(performance.now() - input.trace.startedAt);

  console.info(
    "[syncbay-loader-performance]",
    JSON.stringify({
      details: input.details ?? {},
      metrics: input.trace.metrics(),
      payloadBytes,
      route: input.route,
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? null,
        vercelRegion: process.env.VERCEL_REGION ?? null,
      },
      totalMs,
    }),
  );
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
