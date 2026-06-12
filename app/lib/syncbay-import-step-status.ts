export type ImportStepStatus = "active" | "completed" | "pending";

export function computeSequentialStepStatuses(
  done: boolean[],
): ImportStepStatus[] {
  let activeAssigned = false;

  return done.map((isDone) => {
    if (activeAssigned) return "pending";
    if (isDone) return "completed";

    activeAssigned = true;

    return "active";
  });
}
