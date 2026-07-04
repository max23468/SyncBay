#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_PUBLICATION_TITLE = "Online Store";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CHECK_BATCH_SIZE = 50;
const DEFAULT_BATCH_DELAY_MS = 750;
const DEFAULT_THROTTLE_RETRY_MS = 20_000;
const MAX_SHOPIFY_GRAPHQL_ATTEMPTS = 5;
const SHOPIFY_API_VERSION = "2026-07";

const args = parseArgs(process.argv.slice(2));
const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const publicationTitle = args.publicationTitle ?? DEFAULT_PUBLICATION_TITLE;
const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;

await main().catch((error) => {
  console.error(`Pubblicazione prodotti non riuscita: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const target = await loadTargetProducts();
  const publication = await findPublicationByTitle(
    target.accessToken,
    publicationTitle,
  );

  if (target.productGids.length === 0) {
    console.log(`Nessun prodotto SyncBay attivo da pubblicare per ${shopDomain}.`);
    return;
  }

  console.log(`Shop: ${shopDomain}`);
  console.log(`Publication: ${publication.title} (${publication.id})`);
  console.log(`Prodotti attivi SyncBay: ${target.productGids.length}`);

  if (args.configureSettings) {
    if (args.dryRun) {
      console.log("Dry-run: policy canali non aggiornata.");
    } else {
      await saveSelectedPublicationSetting(target.shopId, publication.id);
      console.log("Policy canali salvata: solo publication selezionata.");
    }
  }

  if (args.dryRun) {
    console.log("Dry-run: nessuna mutation Shopify eseguita.");
    return;
  }

  const productGids = await filterUnpublishedProductGids(
    target.accessToken,
    target.productGids,
    publication.id,
  );
  const alreadyPublishedCount = target.productGids.length - productGids.length;

  if (alreadyPublishedCount > 0) {
    console.log(`Prodotti già pubblicati: ${alreadyPublishedCount}.`);
  }

  if (productGids.length === 0) {
    console.log("Tutti i prodotti attivi SyncBay risultano già pubblicati.");
    return;
  }

  const failures = [];
  let publishedCount = 0;

  for (let index = 0; index < productGids.length; index += batchSize) {
    const batch = productGids.slice(index, index + batchSize);
    const result = await publishProductBatch(
      target.accessToken,
      batch,
      publication.id,
    );

    failures.push(...result.failures);
    publishedCount += result.publishedCount;
    console.log(
      `Batch ${Math.floor(index / batchSize) + 1}: ${result.publishedCount}/${batch.length} pubblicati.`,
    );

    if (index + batchSize < productGids.length) {
      await sleep(DEFAULT_BATCH_DELAY_MS);
    }
  }

  if (failures.length > 0) {
    console.error(JSON.stringify({ failures }, null, 2));
    throw new Error(
      `Pubblicazione incompleta: ${failures.length} prodotti con errore.`,
    );
  }

  console.log(`Pubblicazione completata: ${publishedCount} prodotti.`);
}

async function filterUnpublishedProductGids(
  accessToken,
  productGids,
  publicationId,
) {
  const unpublishedProductGids = [];

  for (
    let index = 0;
    index < productGids.length;
    index += DEFAULT_CHECK_BATCH_SIZE
  ) {
    const batch = productGids.slice(index, index + DEFAULT_CHECK_BATCH_SIZE);
    const parsed = await shopifyGraphql(
      accessToken,
      `query SyncBayPublishedProducts($ids: [ID!]!, $publicationId: ID!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            publishedOnPublication(publicationId: $publicationId)
          }
        }
      }`,
      { ids: batch, publicationId },
    );
    const publishedByProductId = new Map(
      (parsed.nodes ?? [])
        .filter((node) => node?.id)
        .map((node) => [node.id, Boolean(node.publishedOnPublication)]),
    );

    for (const productGid of batch) {
      if (!publishedByProductId.get(productGid)) {
        unpublishedProductGids.push(productGid);
      }
    }

    if (index + DEFAULT_CHECK_BATCH_SIZE < productGids.length) {
      await sleep(DEFAULT_BATCH_DELAY_MS);
    }
  }

  return unpublishedProductGids;
}

async function findPublicationByTitle(accessToken, title) {
  const query = `query SyncBayFindPublication {
    publications(first: 100) {
      nodes {
        id
        name
        catalog {
          title
        }
      }
    }
  }`;
  const parsed = await shopifyGraphql(accessToken, query);
  const publications = parsed.publications?.nodes ?? [];

  const normalizedPublications = publications.map((publication) => ({
    id: publication.id,
    title: publication.catalog?.title ?? publication.name ?? publication.id,
  }));
  const selected = normalizedPublications.find(
    (publication) => publication.title === title,
  );

  if (!selected) {
    throw new Error(
      `Publication Shopify non trovata: ${title}. Disponibili: ${normalizedPublications
        .map((publication) => publication.title)
        .join(", ")}`,
    );
  }

  return selected;
}

async function loadTargetProducts() {
  const sql = `
select jsonb_build_object(
  'shopId', s.id,
  'accessToken', (
    select sess."accessToken"
    from "Session" sess
    where sess.shop = s."shopDomain"
      and sess."isOnline" = false
    order by sess.expires nulls first, sess.id desc
    limit 1
  ),
  'productGids', coalesce(
    jsonb_agg(distinct pm."shopifyProductGid")
      filter (where pm."shopifyProductGid" is not null),
    '[]'::jsonb
  )
) as result
from "Shop" s
left join "ProductMapping" pm on pm."shopId" = s.id
  and pm.status = 'ACTIVE'
where s."shopDomain" = ${sqlString(shopDomain)}
group by s.id
limit 1;
`;
  const diagnostics = await querySupabaseJson(sql);
  const payload = diagnostics.rows?.[0]?.result;

  if (!payload?.shopId) {
    throw new Error(`Shop non trovato in SyncBay: ${shopDomain}.`);
  }

  if (!payload.accessToken) {
    throw new Error(`Token offline Shopify non trovato per ${shopDomain}.`);
  }

  return {
    accessToken: payload.accessToken,
    productGids: payload.productGids ?? [],
    shopId: payload.shopId,
  };
}

async function saveSelectedPublicationSetting(shopId, publicationId) {
  const sql = `
update "Shop"
set
  "productPublicationMode" = 'SELECTED'::"ProductPublicationMode",
  "productPublicationGids" = ${sqlString(publicationId)},
  "updatedAt" = now()
where id = ${sqlString(shopId)};

insert into "AuditLog" ("id", "shopId", "type", "message", "details", "createdAt")
values (
  gen_random_uuid()::text,
  ${sqlString(shopId)},
  'CONNECTION_CHECK',
  'Policy pubblicazione canali Shopify aggiornata: solo Online Store.',
  jsonb_build_object(
    'productPublicationMode', 'SELECTED',
    'productPublicationGids', ${sqlString(publicationId)}
  ),
  now()
);
`;

  await querySupabaseJson(sql);
}

async function publishProductBatch(accessToken, productGids, publicationId) {
  const variableDeclarations = ["$input: [PublicationInput!]!"];
  const mutationFields = [];
  const variables = {
    input: [{ publicationId }],
  };

  productGids.forEach((productGid, index) => {
    variableDeclarations.push(`$productId${index}: ID!`);
    mutationFields.push(`publish${index}: publishablePublish(id: $productId${index}, input: $input) {
      publishable {
        ... on Product {
          id
        }
      }
      userErrors {
        field
        message
      }
    }`);
    variables[`productId${index}`] = productGid;
  });

  const mutation = `mutation SyncBayPublishProducts(${variableDeclarations.join(", ")}) {
    ${mutationFields.join("\n")}
  }`;
  const parsed = await shopifyGraphql(accessToken, mutation, variables);
  const failures = [];

  productGids.forEach((productGid, index) => {
    const result = parsed[`publish${index}`];
    const userErrors = result?.userErrors ?? [];

    if (userErrors.length > 0) {
      failures.push({
        errorMessage: userErrors.map((error) => error.message).join("; "),
        productGid,
      });
      return;
    }

    if (!result?.publishable?.id) {
      failures.push({
        errorMessage: "Shopify non ha restituito il prodotto pubblicato.",
        productGid,
      });
    }
  });

  return {
    failures,
    publishedCount: productGids.length - failures.length,
  };
}

async function shopifyGraphql(accessToken, query, variables = {}) {
  for (let attempt = 1; attempt <= MAX_SHOPIFY_GRAPHQL_ATTEMPTS; attempt += 1) {
    const response = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        body: JSON.stringify({ query, variables }),
        headers: {
          "content-type": "application/json",
          "x-shopify-access-token": accessToken,
        },
        method: "POST",
      },
    );
    const text = await response.text();
    const json = parseJsonResponse(text);
    const errorMessage = getShopifyGraphqlErrorMessage(json);
    const shouldRetry =
      attempt < MAX_SHOPIFY_GRAPHQL_ATTEMPTS &&
      (response.status === 429 || errorMessage.includes("Throttled"));

    if (shouldRetry) {
      const waitMs = DEFAULT_THROTTLE_RETRY_MS * attempt;
      console.log(
        `Shopify ha rallentato la richiesta, retry ${attempt}/${MAX_SHOPIFY_GRAPHQL_ATTEMPTS} tra ${Math.round(
          waitMs / 1000,
        )}s.`,
      );
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Shopify Admin API HTTP ${response.status}.`);
    }

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return json.data ?? {};
  }

  throw new Error("Shopify Admin API non disponibile dopo retry throttle.");
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getShopifyGraphqlErrorMessage(json) {
  return (json.errors ?? [])
    .map((error) => error.message)
    .filter(Boolean)
    .join("; ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function querySupabaseJson(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: process.cwd(),
      env: await getSupabaseCliEnv(),
      maxBuffer: 1024 * 1024 * 10,
      timeout: 60_000,
    },
  );
  const jsonStart = findJsonStart(stdout);

  if (jsonStart < 0) {
    return { rows: [] };
  }

  const parsed = JSON.parse(stdout.slice(jsonStart));

  return Array.isArray(parsed) ? { rows: parsed } : parsed;
}

function parseArgs(argv) {
  const parsed = {
    batchSize: DEFAULT_BATCH_SIZE,
    configureSettings: false,
    dryRun: false,
    publicationTitle: DEFAULT_PUBLICATION_TITLE,
    shop: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--batch-size") {
      parsed.batchSize = Number.parseInt(argv[++index] ?? "", 10);
    } else if (arg === "--configure-settings") {
      parsed.configureSettings = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--publication-title") {
      parsed.publicationTitle = argv[++index] ?? DEFAULT_PUBLICATION_TITLE;
    } else if (arg === "--shop") {
      parsed.shop = argv[++index] ?? null;
    } else {
      throw new Error(`Argomento non supportato: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.batchSize) || parsed.batchSize < 1) {
    throw new Error("--batch-size deve essere un intero positivo.");
  }

  return parsed;
}

function findJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");

  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;

  return Math.min(objectStart, arrayStart);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function formatCliError(error) {
  const stderr =
    typeof error?.stderr === "string" ? sanitizeErrorText(error.stderr) : "";
  const message = sanitizeErrorText(error?.message ?? String(error));
  const useful = stderr || message;

  if (useful.includes("ECIRCUITBREAKER")) {
    return "Supabase ha bloccato temporaneamente nuove connessioni. Attendi qualche minuto e riprova.";
  }

  if (error?.signal === "SIGTERM") {
    return "timeout durante la query o mutation. Riprova tra poco o riduci il batch.";
  }

  return useful.split("\n").filter(Boolean).slice(0, 3).join(" ");
}

function sanitizeErrorText(value) {
  return String(value)
    .replaceAll(/\s+/g, " ")
    .trim();
}
