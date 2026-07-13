import {
  Prisma,
  ProductSnapshotSource,
  SyncConflictStatus,
} from "@prisma/client";

import prisma from "../db.server";
import { getAlignedOpenConflictFields } from "../lib/syncbay-conflict-detection";
import { hashNullableText } from "../lib/syncbay-description-hash";
import type { ShopifyChangeBatchJob } from "../lib/syncbay-shopify-change-batch";
import { getShopifyAdminGraphqlClient } from "./shopify-admin-session.server";

export interface ConflictMapping {
  id: string;
  shopId: string;
  status: "ACTIVE" | "ARCHIVED" | "OUT_OF_STOCK" | "PAUSED" | "ERROR";
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
  shopifyInventoryItemGid: string | null;
}

export interface ConflictBaseline {
  mappingId: string;
  field: "title" | "description" | "price" | "quantity" | "status" | "images";
  serializedValue: string | null;
}

export interface ShopifyConflictProduct {
  productGid: string;
  title: string;
  descriptionHtml: string;
  status: string;
  priceAmount: string | null;
  quantity: number | null;
  imageCount: number;
}

interface ShopifyConflictBatchVariant {
  id?: string | null;
  inventoryQuantity?: number | null;
  price?: string | null;
  inventoryItem?: {
    inventoryLevel?: {
      quantities?: Array<{ name?: string | null; quantity?: number | null }> | null;
    } | null;
  } | null;
}

// Unione dei campi Product e ProductVariant restituiti da `nodes(ids:)`:
// `__typename` distingue i due casi.
interface ShopifyConflictBatchNode extends ShopifyConflictBatchVariant {
  __typename?: string | null;
  title?: string | null;
  descriptionHtml?: string | null;
  status?: string | null;
  media?: { nodes?: Array<{ mediaContentType?: string | null }> } | null;
  variants?: { nodes?: ShopifyConflictBatchVariant[] } | null;
}

export interface ConflictProductTarget {
  mappingId: string;
  productGid: string;
  variantGid: string | null;
}

export interface ConflictDetectionPersistence {
  jobId: string;
  mappingId: string | null;
  outcome: "conflict_opened" | "conflict_resolved" | "mapping_not_found" | "noop" | "failed";
  fields: string[];
  errorCode?: string;
  shopId?: string;
  values?: Record<string, { baseline: string | null; shopify: string | null }>;
}

export interface ShopifyConflictDetectionPorts {
  loadMappings(jobs: ShopifyChangeBatchJob[]): Promise<Map<string, ConflictMapping>>;
  loadBaselines(mappingIds: string[]): Promise<Map<string, ConflictBaseline[]>>;
  loadProducts(input: {
    targets: ConflictProductTarget[];
    shopDomain: string;
    defaultLocationGid: string | null;
  }): Promise<Map<string, ShopifyConflictProduct>>;
  persist(results: ConflictDetectionPersistence[]): Promise<void>;
}

export type ShopifyChangeBatchResult = ConflictDetectionPersistence;
export interface ShopifyChangeBatchExecution {
  results: ShopifyChangeBatchResult[];
  providerReadCount: number;
}

export async function detectShopifyChangesBatch(
  input: {
    jobs: ShopifyChangeBatchJob[];
    shopDomain: string;
    defaultLocationGid?: string | null;
  },
  ports: ShopifyConflictDetectionPorts = createPrismaShopifyConflictDetectionPorts(),
): Promise<ShopifyChangeBatchExecution> {
  const mappings = await ports.loadMappings(input.jobs);
  const mappingByJob = new Map<string, ConflictMapping>();
  const results: ConflictDetectionPersistence[] = [];

  for (const job of input.jobs) {
    const key = job.productGid
      ? `product:${job.productGid}`
      : job.inventoryItemGid
        ? `inventory:${job.inventoryItemGid}`
        : null;
    const mapping = key ? mappings.get(key) : null;
    if (!mapping) {
      results.push({ jobId: job.id, mappingId: null, outcome: "mapping_not_found", fields: [] });
      continue;
    }
    if (mapping.status !== "ACTIVE" || !mapping.shopifyProductGid) {
      results.push({ jobId: job.id, mappingId: mapping.id, outcome: "noop", fields: [] });
      continue;
    }
    mappingByJob.set(job.id, mapping);
  }

  const activeMappings = [...new Map(
    [...mappingByJob.values()].map((mapping) => [mapping.id, mapping]),
  ).values()];
  const baselines = await ports.loadBaselines(activeMappings.map(({ id }) => id));
  // Un target per mapping (non per prodotto): due mapping su varianti diverse
  // dello stesso prodotto Shopify devono confrontare ciascuno la propria
  // variante/location, non solo la prima vista. Il risultato è indicizzato per
  // mappingId così le varianti sorelle non si sovrascrivono a vicenda.
  const targets = activeMappings.flatMap((mapping) =>
    mapping.shopifyProductGid
      ? [{
          mappingId: mapping.id,
          productGid: mapping.shopifyProductGid,
          variantGid: mapping.shopifyVariantGid,
        }]
      : [],
  );
  const products = targets.length > 0
    ? await ports.loadProducts({
        targets,
        shopDomain: input.shopDomain,
        defaultLocationGid: input.defaultLocationGid ?? null,
      })
    : new Map<string, ShopifyConflictProduct>();

  for (const job of input.jobs) {
    const mapping = mappingByJob.get(job.id);
    if (!mapping?.shopifyProductGid) continue;
    const product = products.get(mapping.id);
    if (!product) {
      results.push({
        errorCode: "SHOPIFY_PRODUCT_NOT_FOUND",
        fields: [],
        jobId: job.id,
        mappingId: mapping.id,
        outcome: "failed",
      });
      continue;
    }

    const values = getConflictValues(product, baselines.get(mapping.id) ?? []);
    const fields = Object.keys(values);
    results.push({
      fields,
      jobId: job.id,
      mappingId: mapping.id,
      outcome: fields.length > 0 ? "conflict_opened" : "conflict_resolved",
      shopId: mapping.shopId,
      values,
    });
  }

  await ports.persist(results);
  return { results, providerReadCount: targets.length > 0 ? 1 : 0 };
}

function getConflictValues(
  product: ShopifyConflictProduct,
  baselines: ConflictBaseline[],
) {
  const live: Record<ConflictBaseline["field"], string | null> = {
    title: product.title.trim(),
    description: hashNullableText(product.descriptionHtml),
    price: product.priceAmount,
    quantity: product.quantity === null ? null : String(product.quantity),
    status: product.status.trim().toUpperCase(),
    images: String(product.imageCount),
  };
  return Object.fromEntries(
    baselines.flatMap((baseline) =>
      baseline.serializedValue === live[baseline.field]
        ? []
        : [[baseline.field, { baseline: baseline.serializedValue, shopify: live[baseline.field] }]],
    ),
  );
}

function buildConflictBatchQuery(defaultLocationGid: string | null) {
  const locationVariable = defaultLocationGid ? ", $locationId: ID!" : "";
  const inventoryItemSelection = defaultLocationGid
    ? `inventoryItem { inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } } }`
    : "";
  const variantSelection = `id price inventoryQuantity ${inventoryItemSelection}`;
  return `#graphql
    query SyncBayConflictBatch($ids: [ID!]!${locationVariable}) {
      nodes(ids: $ids) {
        __typename
        ... on Product {
          id
          title
          descriptionHtml
          status
          media(first: 250) { nodes { mediaContentType } }
          variants(first: 1) { nodes { ${variantSelection} } }
        }
        ... on ProductVariant {
          ${variantSelection}
        }
      }
    }`;
}

function getVariantAvailableAtLocation(
  variant: ShopifyConflictBatchVariant | null | undefined,
) {
  const available = variant?.inventoryItem?.inventoryLevel?.quantities?.find(
    (quantity) => quantity.name === "available",
  )?.quantity;

  return typeof available === "number" ? available : null;
}

export function createPrismaShopifyConflictDetectionPorts(): ShopifyConflictDetectionPorts {
  return {
    async loadMappings(jobs) {
      const productGids = jobs.flatMap(({ productGid }) => productGid ? [productGid] : []);
      const inventoryGids = jobs.flatMap(({ inventoryItemGid }) => inventoryItemGid ? [inventoryItemGid] : []);
      const rows = await prisma.productMapping.findMany({
        where: {
          shopId: jobs[0]?.shopId,
          OR: [
            { shopifyProductGid: { in: productGids } },
            { shopifyInventoryItemGid: { in: inventoryGids } },
          ],
        },
      });
      const map = new Map<string, ConflictMapping>();
      for (const row of rows) {
        if (row.shopifyProductGid) map.set(`product:${row.shopifyProductGid}`, row);
        if (row.shopifyInventoryItemGid) map.set(`inventory:${row.shopifyInventoryItemGid}`, row);
      }
      return map;
    },
    async loadBaselines(mappingIds) {
      const baselines = await prisma.productSyncBaseline.findMany({
        where: { mappingId: { in: mappingIds } },
      });
      const result = new Map<string, ConflictBaseline[]>();
      for (const baseline of baselines) {
        const current: ConflictBaseline[] = [];
        const add = (field: ConflictBaseline["field"], value: unknown) => {
          if (value == null) return;
          current.push({ mappingId: baseline.mappingId, field, serializedValue: String(value) });
        };
        add("title", baseline.title);
        add("description", baseline.descriptionHash);
        add("price", baseline.priceAmount?.toFixed(2));
        add("quantity", baseline.quantity);
        add("status", baseline.productStatus?.toUpperCase());
        add("images", baseline.imageCount);
        result.set(baseline.mappingId, current);
      }

      const snapshots = await prisma.productSnapshot.findMany({
        orderBy: { capturedAt: "desc" },
        where: { mappingId: { in: mappingIds }, source: ProductSnapshotSource.SYNCBAY },
      });
      for (const snapshot of snapshots) {
        if (!snapshot.mappingId) continue;
        const current = result.get(snapshot.mappingId) ?? [];
        const add = (field: ConflictBaseline["field"], value: unknown) => {
          if (value == null || current.some((entry) => entry.field === field)) return;
          current.push({ mappingId: snapshot.mappingId!, field, serializedValue: String(value) });
        };
        add("title", snapshot.title);
        add("description", snapshot.descriptionHash);
        add("price", snapshot.priceAmount?.toFixed(2));
        add("quantity", snapshot.quantity);
        add("status", snapshot.productStatus?.toUpperCase());
        add("images", snapshot.imageCount);
        result.set(snapshot.mappingId, current);
      }
      return result;
    },
    async loadProducts({ targets, shopDomain, defaultLocationGid }) {
      const admin = await getShopifyAdminGraphqlClient(shopDomain);
      // Budget di lettura provider sui prodotti distinti; i mapping oltre il cap
      // restano fuori dalla mappa e vengono ritentati come SHOPIFY_PRODUCT_NOT_FOUND.
      const cappedProductGids = [...new Set(targets.map((target) => target.productGid))]
        .slice(0, 25);
      const includedProducts = new Set(cappedProductGids);
      const cappedTargets = targets.filter((target) =>
        includedProducts.has(target.productGid),
      );
      // I nodi ProductVariant portano la variante di ciascun mapping: li
      // richiediamo nella stessa `nodes(ids:)` dei prodotti, un solo read copre
      // entrambi.
      const variantGids = [...new Set(
        cappedTargets.flatMap((target) => target.variantGid ? [target.variantGid] : []),
      )];
      const ids = [...cappedProductGids, ...variantGids];
      const response = await admin.graphql(
        buildConflictBatchQuery(defaultLocationGid),
        {
          variables: defaultLocationGid
            ? { ids, locationId: defaultLocationGid }
            : { ids },
        },
      );
      const body = await response.json() as {
        data?: { nodes?: ShopifyConflictBatchNode[] };
      };
      const nodes = body.data?.nodes ?? [];
      const productByGid = new Map<string, ShopifyConflictBatchNode>();
      const variantByGid = new Map<string, ShopifyConflictBatchVariant>();
      for (const node of nodes) {
        if (!node?.id) continue;
        if (node.__typename === "ProductVariant") {
          variantByGid.set(node.id, {
            id: node.id,
            inventoryItem: node.inventoryItem,
            inventoryQuantity: node.inventoryQuantity,
            price: node.price,
          });
        } else {
          productByGid.set(node.id, node);
        }
      }
      const hasManagedLocation = Boolean(defaultLocationGid);
      const result = new Map<string, ShopifyConflictProduct>();
      for (const target of cappedTargets) {
        const productNode = productByGid.get(target.productGid);
        if (!productNode) continue;
        const firstVariant = productNode.variants?.nodes?.[0] ?? null;
        const variant =
          (target.variantGid ? variantByGid.get(target.variantGid) : null) ?? firstVariant;
        const locationQuantity = getVariantAvailableAtLocation(variant);
        const quantity = hasManagedLocation
          ? locationQuantity
          : locationQuantity ?? variant?.inventoryQuantity ?? null;
        result.set(target.mappingId, {
          productGid: target.productGid,
          title: productNode.title ?? "",
          descriptionHtml: productNode.descriptionHtml ?? "",
          status: productNode.status ?? "",
          priceAmount: variant?.price ?? null,
          quantity,
          imageCount: productNode.media?.nodes?.filter(
            (media) => media.mediaContentType === "IMAGE",
          ).length ?? 0,
        });
      }
      return result;
    },
    async persist(results) {
      for (const result of results) {
        if (!result.mappingId || !result.shopId || result.outcome === "failed") continue;
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- letture conflitti per mapping, in serie per contenere le connessioni concorrenti sul pooler.
        const open = await prisma.syncConflict.findMany({
          select: { field: true, id: true },
          where: { mappingId: result.mappingId, status: SyncConflictStatus.OPEN },
        });
        for (const field of result.fields) {
          const values = result.values?.[field];
          const existing = open.find((conflict) => conflict.field === field);
          const data = {
            detectedAt: new Date(),
            ebayValue: values?.baseline ?? Prisma.JsonNull,
            lastSyncBayValue: values?.baseline ?? Prisma.JsonNull,
            shopifyValue: values?.shopify ?? Prisma.JsonNull,
          };
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- scritture conflitti per campo, in serie per contenere le connessioni concorrenti sul pooler.
          if (existing) await prisma.syncConflict.update({ data, where: { id: existing.id } });
          else await prisma.syncConflict.create({ data: { ...data, field, mappingId: result.mappingId, shopId: result.shopId } });
        }
        const alignedFields = getAlignedOpenConflictFields({
          detectedConflictFields: result.fields,
          openConflictFields: open.map(({ field }) => field),
        });
        if (alignedFields.length > 0) {
          await prisma.syncConflict.updateMany({
            data: { resolvedAt: new Date(), status: SyncConflictStatus.RESOLVED },
            where: { field: { in: alignedFields }, mappingId: result.mappingId, status: SyncConflictStatus.OPEN },
          });
        }
      }
    },
  };
}
