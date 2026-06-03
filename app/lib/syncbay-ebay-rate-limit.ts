export const DEFAULT_EBAY_TRADING_RATE_LIMIT_RESET_UTC_HOUR = 7;
export const DEFAULT_EBAY_TRADING_RATE_LIMIT_RESET_GRACE_SECONDS = 5 * 60;

const RATE_LIMIT_PATTERNS = [
  /superato il limite di utilizzo/i,
  /exceeded the usage limit/i,
  /call limit/i,
  /rate limit/i,
];

export function isEbayTradingUsageLimitError(message: string) {
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

export function getEbayTradingRateLimitCooldownSeconds(value?: string | null) {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, 24 * 60 * 60);
}

export function getNextEbayTradingRateLimitRetryAt(input: {
  cooldownSecondsValue?: string | null;
  now: Date;
}) {
  const cooldownSeconds = getEbayTradingRateLimitCooldownSeconds(
    input.cooldownSecondsValue,
  );

  if (cooldownSeconds) {
    return new Date(input.now.getTime() + cooldownSeconds * 1000);
  }

  return getNextEbayTradingDailyResetAt(input.now);
}

export function getNextEbayTradingDailyResetAt(now: Date) {
  const resetAt = new Date(now);
  resetAt.setUTCHours(
    DEFAULT_EBAY_TRADING_RATE_LIMIT_RESET_UTC_HOUR,
    0,
    DEFAULT_EBAY_TRADING_RATE_LIMIT_RESET_GRACE_SECONDS,
    0,
  );

  if (resetAt <= now) {
    resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  }

  return resetAt;
}
