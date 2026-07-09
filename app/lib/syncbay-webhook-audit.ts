export function shouldWriteShopifyWebhookAuditLog(input: {
  jobCoalesced: boolean;
  jobCreated: boolean;
  jobType: string | null;
}) {
  if (!input.jobType) return true;

  return input.jobCreated && !input.jobCoalesced;
}
