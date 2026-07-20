export const RUNNER_LANES = [
  "UPDATE_EBAY_STOCK",
  "SYNC_INCREMENTAL",
  "ARCHIVE_INACTIVE_LISTING",
  "DETECT_SHOPIFY_CHANGES",
  "IMPORT_CATALOG",
  "RECONCILE_CATALOG",
  "CLEANUP_STAGING",
] as const;

export type RunnerLane = (typeof RUNNER_LANES)[number];

const RUNNER_CLAIM_SAFETY_WINDOW_MS = 5_000;

export function buildRunnerLanePlan(input: {
  dueByType: Record<RunnerLane, number>;
  limit: number;
}): RunnerLane[] {
  const remaining = { ...input.dueByType };
  const plan: RunnerLane[] = [];
  const take = (lane: RunnerLane) => {
    if (plan.length >= input.limit || remaining[lane] <= 0) return;
    plan.push(lane);
    remaining[lane] -= 1;
  };

  take("UPDATE_EBAY_STOCK");
  take("DETECT_SHOPIFY_CHANGES");

  const fillOrder: RunnerLane[] = [
    "SYNC_INCREMENTAL",
    "ARCHIVE_INACTIVE_LISTING",
    "IMPORT_CATALOG",
    "RECONCILE_CATALOG",
    "CLEANUP_STAGING",
    "DETECT_SHOPIFY_CHANGES",
    "UPDATE_EBAY_STOCK",
  ];

  while (plan.length < input.limit) {
    const lane = fillOrder.find((candidate) => remaining[candidate] > 0);
    if (!lane) break;
    take(lane);
  }

  return plan;
}

export function shouldClaimRunnerJob(input: { deadlineAt?: Date; now: Date }) {
  if (!input.deadlineAt) return true;

  return input.deadlineAt.getTime() - input.now.getTime() > RUNNER_CLAIM_SAFETY_WINDOW_MS;
}
