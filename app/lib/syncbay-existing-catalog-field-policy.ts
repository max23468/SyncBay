export type ExistingCatalogHandlePolicy = {
  currentHandle: string | null;
  operation: "preserve";
  redirectRequired: false;
};

export type ExistingCatalogImagesPolicy = {
  operation: "preserve" | "sync_from_ebay_if_available";
};

export type ExistingCatalogTagsPolicy = {
  add: string[];
  preserve: string[];
  remove: string[];
};

export interface ExistingCatalogFieldPolicy {
  handle: ExistingCatalogHandlePolicy;
  images: ExistingCatalogImagesPolicy;
  tags: ExistingCatalogTagsPolicy;
}

export type ShopifyMediaPolicyNode = {
  id?: string | null;
  mediaContentType?: string | null;
};

type JsonValue =
  JsonValue[] | { [key: string]: JsonValue } | boolean | null | number | string;
type JsonObject = { [key: string]: JsonValue };

const SYNCBAY_SHOPIFY_SOURCE_TAG = "Negozio eBay";
const LEGACY_TAG_ALLOWLIST_LIMIT = 50;

export function buildExistingCatalogFieldPolicy(input: {
  currentHandle?: string | null;
  currentTags?: string[];
  legacyTagsToRemove?: string[];
  shopifyImageCount: number;
  syncbayLegacyTags: string[];
}): ExistingCatalogFieldPolicy {
  const exactRemovals = new Set([
    ...input.syncbayLegacyTags,
    ...(input.legacyTagsToRemove ?? []),
  ]);
  const currentTags = input.currentTags ?? [];
  const tagsToRemove = currentTags.filter((tag) => exactRemovals.has(tag));
  const preservedTags = currentTags.filter((tag) => !exactRemovals.has(tag));
  const sourceTagAlreadyPresent = currentTags.includes(
    SYNCBAY_SHOPIFY_SOURCE_TAG,
  );

  return {
    handle: {
      currentHandle: normalizeNullableText(input.currentHandle),
      operation: "preserve",
      redirectRequired: false,
    },
    images: {
      operation:
        input.shopifyImageCount > 0
          ? "preserve"
          : "sync_from_ebay_if_available",
    },
    tags: {
      add: sourceTagAlreadyPresent ? [] : [SYNCBAY_SHOPIFY_SOURCE_TAG],
      preserve: preservedTags,
      remove: tagsToRemove,
    },
  };
}

export function parseExistingCatalogLegacyTagsToRemove(
  value: FormDataEntryValue | null,
) {
  if (typeof value !== "string") return [];

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const tag of value.split(",")) {
    const normalized = tag.trim();
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    tags.push(normalized);

    if (tags.length >= LEGACY_TAG_ALLOWLIST_LIMIT) break;
  }

  return tags;
}

export function parseExistingCatalogFieldPoliciesByItemId(value: unknown) {
  const input = getRecord(value);
  const policies: Record<string, ExistingCatalogFieldPolicy> = {};

  for (const [itemId, rawPolicy] of Object.entries(input)) {
    const policy = parseExistingCatalogFieldPolicy(rawPolicy);
    if (!policy) continue;

    policies[itemId] = policy;
  }

  return policies;
}

export function serializeExistingCatalogFieldPoliciesByItemId(
  policies: Record<string, ExistingCatalogFieldPolicy>,
): JsonObject {
  const payload: JsonObject = {};

  for (const [itemId, policy] of Object.entries(policies)) {
    payload[itemId] = {
      handle: {
        currentHandle: policy.handle.currentHandle,
        operation: policy.handle.operation,
        redirectRequired: policy.handle.redirectRequired,
      },
      images: {
        operation: policy.images.operation,
      },
      tags: {
        add: policy.tags.add,
        preserve: policy.tags.preserve,
        remove: policy.tags.remove,
      },
    };
  }

  return payload;
}

export function shouldSyncExistingCatalogImages(input: {
  currentImageCount: number;
  fieldPolicy?: ExistingCatalogFieldPolicy | null;
}) {
  if (!input.fieldPolicy) return true;

  return input.currentImageCount === 0;
}

export function getShopifyImageMediaIds(
  mediaNodes?: ShopifyMediaPolicyNode[] | null,
) {
  const imageIds: string[] = [];

  for (const media of mediaNodes ?? []) {
    const id = normalizeNullableText(media.id);
    if (!id || media.mediaContentType !== "IMAGE") continue;

    imageIds.push(id);
  }

  return imageIds;
}

export function buildExistingCatalogTagMutations(input: {
  currentTags?: string[] | null;
  fieldPolicy?: ExistingCatalogFieldPolicy | null;
}) {
  const currentTags = new Set(input.currentTags ?? []);
  const fieldPolicy = input.fieldPolicy;

  if (!fieldPolicy) return { add: [], remove: [] };

  return {
    add: fieldPolicy.tags.add.filter((tag) => !currentTags.has(tag)),
    remove: fieldPolicy.tags.remove.filter((tag) => currentTags.has(tag)),
  };
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseExistingCatalogFieldPolicy(
  value: unknown,
): ExistingCatalogFieldPolicy | null {
  const policy = getRecord(value);
  const handle = getRecord(policy.handle);
  const images = getRecord(policy.images);
  const tags = getRecord(policy.tags);
  const imageOperation = images.operation;

  if (handle.operation !== "preserve" || handle.redirectRequired !== false) {
    return null;
  }
  if (
    imageOperation !== "preserve" &&
    imageOperation !== "sync_from_ebay_if_available"
  ) {
    return null;
  }

  return {
    handle: {
      currentHandle:
        typeof handle.currentHandle === "string" ? handle.currentHandle : null,
      operation: "preserve",
      redirectRequired: false,
    },
    images: {
      operation: imageOperation,
    },
    tags: {
      add: getStringArray(tags.add),
      preserve: getStringArray(tags.preserve),
      remove: getStringArray(tags.remove),
    },
  };
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
