export const DEFAULT_RECENT_PR_DAYS = 7;

export function getRecentPrDays(value) {
  return parsePositiveInteger(value, DEFAULT_RECENT_PR_DAYS);
}

export function getCodexPrScanMode(input) {
  if (input.codeFullScan) return "full-history";

  if (!input.eventName) return "broad";
  if (input.eventName === "schedule" || input.eventName === "workflow_dispatch") {
    return "broad";
  }
  if (
    input.eventName === "issue_comment" &&
    input.eventPayload?.issue?.title ===
      (input.inboxIssueTitle ?? "Codex feedback inbox")
  ) {
    return "broad";
  }

  return getEventPullRequestNumber(input.eventPayload) ? "targeted" : "broad";
}

export function getEventPullRequestNumber(payload) {
  if (payload?.pull_request?.number) return payload.pull_request.number;
  if (payload?.issue?.pull_request) return payload.issue.number;

  return null;
}

export function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function shouldPatchInboxIssue(input) {
  return !(
    input.body === input.nextBody &&
    input.state === "open" &&
    input.isLabeledInboxIssue
  );
}
