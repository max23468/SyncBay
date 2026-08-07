import { createHash } from "node:crypto";

import {
  SYNCBAY_SOLD_OUT_TAG,
  ShopifyAdminGraphqlClient,
  ShopifyCreatedProduct,
  ShopifyDraftProductInput,
  ShopifyDraftProductVariantNode,
  ShopifyInventoryItemUpdateResponse,
  ShopifyInventorySyncResult,
  ShopifyProductVariantsBulkUpdateResponse,
  ShopifyUserError,
  formatShopifyGraphqlErrors,
  formatShopifyUserErrors,
  getFirstProductVariant,
  updateShopifyProductTag,
} from "./shopify-import-shared.server";

interface ShopifyInventoryActivateResponse {
  data?: {
    inventoryActivate?: {
      inventoryLevel?: {
        id: string;
      } | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyInventorySetQuantitiesResponse {
  data?: {
    inventorySetQuantities?: {
      inventoryAdjustmentGroup?: {
        referenceDocumentUri?: string | null;
      } | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductSoldOutLookupResponse {
  data?: {
    node?: {
      id: string;
      variants?: {
        nodes?: ShopifyDraftProductVariantNode[];
      } | null;
    } | null;
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyVariantSoldOutLookupResponse {
  data?: {
    node?: ShopifyDraftProductVariantNode | null;
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyInventoryVerificationResponse {
  data?: {
    node?: {
      id?: string;
      tracked?: boolean | null;
      inventoryLevel?: {
        quantities?: Array<{
          name: string;
          quantity: number;
        }>;
      } | null;
    } | null;
  };
  errors?: Array<{
    message: string;
  }>;
}

export async function syncShopifyInventoryFromEbayQuantity(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  draftProduct: ShopifyDraftProductInput,
  context: {
    defaultLocationGid: string | null;
    jobId: string;
  },
): Promise<ShopifyInventorySyncResult> {
  const quantity = draftProduct.previewItem.normalized.quantity;
  const variant = getFirstProductVariant(product);
  const inventoryItemGid = variant?.inventoryItem?.id;

  if (!context.defaultLocationGid) {
    return {
      message: "Location Shopify predefinita assente.",
      reason: "missing_location",
      status: "skipped",
      variantGid: variant?.id,
    };
  }

  if (quantity === null) {
    return {
      message: "Quantità eBay non disponibile per il prodotto importato.",
      reason: "missing_quantity",
      status: "skipped",
      variantGid: variant?.id,
    };
  }

  if (!variant || !inventoryItemGid) {
    return {
      message: "Inventory item Shopify non restituito per la variante importata.",
      reason: "missing_inventory_item",
      status: "skipped",
      variantGid: variant?.id,
    };
  }

  const trackingResult = await updateShopifyInventoryItemTracking(admin, inventoryItemGid);

  if (trackingResult.status === "failed") {
    return {
      ...trackingResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  const activationResult = await activateShopifyInventoryAtLocation(admin, {
    inventoryItemGid,
    locationGid: context.defaultLocationGid,
    quantity,
  });

  if (activationResult.status === "failed") {
    return {
      ...activationResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  const quantityResult = await setShopifyInventoryQuantity(admin, {
    inventoryItemGid,
    jobId: context.jobId,
    locationGid: context.defaultLocationGid,
    quantity,
  });

  if (quantityResult.status === "failed") {
    return {
      ...quantityResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  const verificationResult = await verifyShopifyInventoryAtLocation(admin, {
    inventoryItemGid,
    locationGid: context.defaultLocationGid,
    quantity,
  });

  if (verificationResult.status === "failed") {
    return {
      ...verificationResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  return {
    inventoryItemGid,
    locationGid: context.defaultLocationGid,
    quantity,
    status: "synced",
    variantGid: variant.id,
  };
}

async function updateShopifyInventoryItemTracking(
  admin: ShopifyAdminGraphqlClient,
  inventoryItemGid: string,
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayTrackInventoryItem($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem {
          id
          tracked
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: inventoryItemGid,
        input: {
          tracked: true,
        },
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryItemUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify inventoryItemUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.inventoryItemUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function activateShopifyInventoryAtLocation(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    locationGid: string;
    quantity: number;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayActivateInventoryItem($available: Int, $idempotencyKey: String!, $inventoryItemId: ID!, $locationId: ID!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $idempotencyKey) {
        inventoryLevel {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        available: input.quantity,
        idempotencyKey: buildShopifyMutationIdempotencyKey({
          inventoryItemGid: input.inventoryItemGid,
          locationGid: input.locationGid,
          operation: "inventory-activate",
          quantity: input.quantity,
        }),
        inventoryItemId: input.inventoryItemGid,
        locationId: input.locationGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryActivateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify inventoryActivate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.inventoryActivate?.userErrors ?? [];

  if (userErrors.length > 0 && !isAlreadyActiveInventoryError(userErrors)) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function setShopifyInventoryQuantity(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    jobId: string;
    locationGid: string;
    quantity: number;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const currentQuantityResult = await getShopifyInventoryAvailableQuantity(admin, {
    inventoryItemGid: input.inventoryItemGid,
    locationGid: input.locationGid,
  });

  if (currentQuantityResult.status === "failed") return currentQuantityResult;

  const changeFromQuantity = currentQuantityResult.availableQuantity ?? 0;

  const response = await admin.graphql(
    `#graphql
    mutation SyncBaySetInventoryQuantity($idempotencyKey: String!, $input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup {
          referenceDocumentUri
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        idempotencyKey: buildShopifyMutationIdempotencyKey({
          inventoryItemGid: input.inventoryItemGid,
          jobId: input.jobId,
          locationGid: input.locationGid,
          changeFromQuantity,
          operation: "inventory-set-quantities",
          quantity: input.quantity,
        }),
        input: {
          name: "available",
          quantities: [
            {
              changeFromQuantity,
              inventoryItemId: input.inventoryItemGid,
              locationId: input.locationGid,
              quantity: input.quantity,
            },
          ],
          reason: "correction",
          referenceDocumentUri: `gid://syncbay/SyncJob/${input.jobId}`,
        },
      },
    },
  );
  const json = (await response.json()) as ShopifyInventorySetQuantitiesResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify inventorySetQuantities ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.inventorySetQuantities?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

/**
 * Mette un prodotto Shopify nello stato "esaurito" quando il listing eBay
 * collegato è diventato inattivo: lo stato del prodotto resta ACTIVE (la pagina
 * e il suo URL restano serviti e indicizzabili), la scorta viene azzerata con
 * politica DENY e viene applicato il tag `esaurito`. Vedi ADR 0011.
 *
 * Non lancia per problemi parziali su scorta o tag: raccoglie avvisi e li
 * restituisce, così il listing risulta comunque marcato come esaurito.
 */
export async function markShopifyProductSoldOut(
  admin: ShopifyAdminGraphqlClient,
  input: {
    jobId: string;
    locationGid: string | null;
    productGid: string;
    variantGid?: string | null;
  },
): Promise<{ status: "synced"; warnings: string[] }> {
  const warnings: string[] = [];

  const hasMappedVariant = Boolean(input.variantGid?.trim());
  const variant = hasMappedVariant
    ? await getShopifyVariantForSoldOut(admin, input.variantGid?.trim() ?? "")
    : await getFirstShopifyProductVariantForSoldOut(admin, input.productGid);
  const inventoryItemGid = variant?.inventoryItem?.id ?? null;

  if (hasMappedVariant && !variant) {
    warnings.push("Variante Shopify mappata non disponibile: scorta e policy non aggiornate.");
  }

  if (variant) {
    const policyResult = await setShopifyVariantInventoryPolicyDeny(admin, {
      productGid: input.productGid,
      variantGid: variant.id,
    });

    if (policyResult.status === "failed") {
      warnings.push(policyResult.errorMessage);
    }
  } else if (!hasMappedVariant) {
    warnings.push("Politica di inventario non aggiornata: variante Shopify non disponibile.");
  }

  if (variant && inventoryItemGid && input.locationGid) {
    const trackingResult = await updateShopifyInventoryItemTracking(admin, inventoryItemGid);

    if (trackingResult.status === "failed") {
      warnings.push(trackingResult.errorMessage);
    } else {
      const activationResult = await activateShopifyInventoryAtLocation(admin, {
        inventoryItemGid,
        locationGid: input.locationGid,
        quantity: 0,
      });

      if (activationResult.status === "failed") {
        warnings.push(activationResult.errorMessage);
      }

      const quantityResult = await setShopifyInventoryQuantity(admin, {
        inventoryItemGid,
        jobId: input.jobId,
        locationGid: input.locationGid,
        quantity: 0,
      });

      if (quantityResult.status === "failed") {
        warnings.push(quantityResult.errorMessage);
      }
    }
  } else if (!input.locationGid) {
    warnings.push("Scorta non azzerata: location Shopify predefinita assente.");
  } else if (!inventoryItemGid) {
    warnings.push("Scorta non azzerata: inventory item Shopify non disponibile.");
  }

  const tagResult = await updateShopifyProductTag(admin, {
    operation: "add",
    productGid: input.productGid,
    tag: SYNCBAY_SOLD_OUT_TAG,
  });

  if (tagResult.status === "failed") {
    warnings.push(tagResult.errorMessage);
  }

  return { status: "synced", warnings };
}

async function getFirstShopifyProductVariantForSoldOut(
  admin: ShopifyAdminGraphqlClient,
  productGid: string,
) {
  const lookupResponse = await admin.graphql(
    `#graphql
    query SyncBaySoldOutProductLookup($id: ID!) {
      node(id: $id) {
        ... on Product {
          id
          variants(first: 1) {
            nodes {
              id
              price
              compareAtPrice
              inventoryItem {
                id
                tracked
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        id: productGid,
      },
    },
  );

  if (!lookupResponse.ok) {
    throw new Error(
      `Shopify non ha restituito il prodotto da mettere in esaurito (HTTP ${lookupResponse.status}).`,
    );
  }

  const lookupJson = (await lookupResponse.json()) as ShopifyProductSoldOutLookupResponse;

  if (lookupJson.errors?.length) {
    throw new Error(formatShopifyGraphqlErrors(lookupJson.errors));
  }

  return lookupJson.data?.node?.variants?.nodes?.[0] ?? null;
}

async function getShopifyVariantForSoldOut(admin: ShopifyAdminGraphqlClient, variantGid: string) {
  const lookupResponse = await admin.graphql(
    `#graphql
    query SyncBaySoldOutVariantLookup($id: ID!) {
      node(id: $id) {
        ... on ProductVariant {
          id
          inventoryItem {
            id
            tracked
          }
        }
      }
    }`,
    {
      variables: {
        id: variantGid,
      },
    },
  );

  if (!lookupResponse.ok) {
    throw new Error(
      `Shopify non ha restituito la variante da mettere in esaurito (HTTP ${lookupResponse.status}).`,
    );
  }

  const lookupJson = (await lookupResponse.json()) as ShopifyVariantSoldOutLookupResponse;

  if (lookupJson.errors?.length) {
    throw new Error(formatShopifyGraphqlErrors(lookupJson.errors));
  }

  return lookupJson.data?.node ?? null;
}

async function setShopifyVariantInventoryPolicyDeny(
  admin: ShopifyAdminGraphqlClient,
  input: {
    productGid: string;
    variantGid: string;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBaySetVariantInventoryPolicyDeny($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        productId: input.productGid,
        variants: [
          {
            id: input.variantGid,
            inventoryPolicy: "DENY",
          },
        ],
      },
    },
  );

  if (!response.ok) {
    return {
      errorMessage: `Shopify productVariantsBulkUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  const json = (await response.json()) as ShopifyProductVariantsBulkUpdateResponse;

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productVariantsBulkUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function getShopifyInventoryAvailableQuantity(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    locationGid: string;
  },
): Promise<
  | {
      availableQuantity: number | null;
      status: "synced";
    }
  | { errorMessage: string; status: "failed" }
> {
  const response = await admin.graphql(
    `#graphql
    query SyncBayCurrentInventoryQuantity($inventoryItemGid: ID!, $locationGid: ID!) {
      node(id: $inventoryItemGid) {
        ... on InventoryItem {
          id
          inventoryLevel(locationId: $locationGid) {
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }`,
    {
      variables: {
        inventoryItemGid: input.inventoryItemGid,
        locationGid: input.locationGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryVerificationResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify lettura quantità corrente ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const inventoryItem = json.data?.node;

  if (!inventoryItem) {
    return {
      errorMessage: "Shopify non ha restituito l'inventory item per leggere la quantità corrente.",
      status: "failed",
    };
  }

  return {
    availableQuantity:
      inventoryItem.inventoryLevel?.quantities?.find((quantity) => quantity.name === "available")
        ?.quantity ?? null,
    status: "synced",
  };
}

async function verifyShopifyInventoryAtLocation(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    locationGid: string;
    quantity: number;
  },
): Promise<{ status: "synced"; warning?: string } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    query SyncBayVerifyInventory($inventoryItemGid: ID!, $locationGid: ID!) {
      node(id: $inventoryItemGid) {
        ... on InventoryItem {
          id
          tracked
          inventoryLevel(locationId: $locationGid) {
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }`,
    {
      variables: {
        inventoryItemGid: input.inventoryItemGid,
        locationGid: input.locationGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryVerificationResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify verifica inventario ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const inventoryItem = json.data?.node;

  if (!inventoryItem) {
    return {
      errorMessage: "Shopify non ha restituito l'inventory item da verificare.",
      status: "failed",
    };
  }

  if (inventoryItem.tracked !== true) {
    return {
      errorMessage: "Shopify non ha confermato il tracking scorte attivo.",
      status: "failed",
    };
  }

  const availableQuantity =
    inventoryItem.inventoryLevel?.quantities?.find((quantity) => quantity.name === "available")
      ?.quantity ?? null;

  if (availableQuantity !== input.quantity) {
    return {
      warning: `Shopify riporta una quantità diversa (${availableQuantity ?? "assente"}) rispetto a quella appena scritta (${input.quantity}); la verifica può variare per aggiornamenti concorrenti.`,
      status: "synced",
    };
  }

  return { status: "synced" };
}

function isAlreadyActiveInventoryError(errors: ShopifyUserError[]) {
  return errors.every((error) => {
    const normalizedMessage = error.message.toLowerCase();

    return (
      normalizedMessage.includes("already") &&
      (normalizedMessage.includes("active") || normalizedMessage.includes("stock"))
    );
  });
}

function buildShopifyMutationIdempotencyKey(input: {
  inventoryItemGid: string;
  jobId?: string;
  locationGid: string;
  operation: string;
  quantity: number;
  changeFromQuantity?: number;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        inventoryItemGid: input.inventoryItemGid,
        jobId: input.jobId ?? null,
        locationGid: input.locationGid,
        operation: input.operation,
        changeFromQuantity: input.changeFromQuantity ?? null,
        quantity: input.quantity,
      }),
    )
    .digest("hex");
}
