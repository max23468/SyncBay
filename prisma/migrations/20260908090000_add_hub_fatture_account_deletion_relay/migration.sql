CREATE TYPE "EbayAccountDeletionRelayStatus" AS ENUM (
  'PENDING',
  'DELIVERING',
  'RETRYING',
  'DELIVERED'
);

ALTER TABLE "EbayAccountDeletionRequest"
  ADD COLUMN "relayStatus" "EbayAccountDeletionRelayStatus",
  ADD COLUMN "encryptedRelayBody" TEXT,
  ADD COLUMN "encryptedRelaySignature" TEXT,
  ADD COLUMN "relayAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "relayNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "relayStartedAt" TIMESTAMP(3),
  ADD COLUMN "relayedAt" TIMESTAMP(3),
  ADD COLUMN "relayLastErrorCode" TEXT;

ALTER TABLE "EbayAccountDeletionRequest"
  ADD CONSTRAINT "EbayAccountDeletionRequest_relay_state_check" CHECK (
    ("relayStatus" IS NULL
      AND "encryptedRelayBody" IS NULL
      AND "encryptedRelaySignature" IS NULL
      AND "relayNextAttemptAt" IS NULL
      AND "relayStartedAt" IS NULL
      AND "relayedAt" IS NULL)
    OR
    ("relayStatus" = 'PENDING'
      AND "encryptedRelayBody" IS NOT NULL
      AND "encryptedRelaySignature" IS NOT NULL
      AND "relayNextAttemptAt" IS NULL
      AND "relayStartedAt" IS NULL
      AND "relayedAt" IS NULL)
    OR
    ("relayStatus" = 'DELIVERING'
      AND "encryptedRelayBody" IS NOT NULL
      AND "encryptedRelaySignature" IS NOT NULL
      AND "relayNextAttemptAt" IS NULL
      AND "relayStartedAt" IS NOT NULL
      AND "relayedAt" IS NULL)
    OR
    ("relayStatus" = 'RETRYING'
      AND "encryptedRelayBody" IS NOT NULL
      AND "encryptedRelaySignature" IS NOT NULL
      AND "relayNextAttemptAt" IS NOT NULL
      AND "relayStartedAt" IS NULL
      AND "relayedAt" IS NULL)
    OR
    ("relayStatus" = 'DELIVERED'
      AND "encryptedRelayBody" IS NULL
      AND "encryptedRelaySignature" IS NULL
      AND "relayNextAttemptAt" IS NULL
      AND "relayStartedAt" IS NULL
      AND "relayedAt" IS NOT NULL)
  );

CREATE INDEX "EbayAccountDeletionRequest_relayStatus_relayNextAttemptAt_idx"
  ON "EbayAccountDeletionRequest"("relayStatus", "relayNextAttemptAt");
