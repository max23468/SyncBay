export function shouldContinueRunningSyncJob(status: string | null) {
  return status === "RUNNING";
}
