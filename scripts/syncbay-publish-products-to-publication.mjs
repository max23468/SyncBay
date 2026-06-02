#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";
const DEFAULT_PUBLICATION_TITLE = "Online Store";
const DEFAULT_BATCH_SIZE = 20;
const SHOPIFY_API_VERSION = "2026-04";
const SHOPIFY_AGENT_ENV = {
  SHOPIFY_CLI_AGENT_IDS: "s:syncbay|r:publish-products|i:codex",
  SHOPIFY_CLI_AGENT_INFO: "n:codex|v:gpt-5|p:openai",
};

const args = parseArgs(process.argv.slice(2));
const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;
const publicationTitle = args.publicationTitle ?? DEFAULT_PUBLICATION_TITLE;
const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;

await main().catch((error) => {
  console.error(`Pubblicazione prodotti non riuscita: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const [publication, target] = await Promise.all([
    findPublicationByTitle(publicationTitle),
    loadTargetProducts(),
  ]);

  if (!publication) {
    throw new Error(`Publication Shopify non trovata: ${publicationTitle}.`);
  }

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

  const failures = [];
  let publishedCount = 0;

  for (let index = 0; index < target.productGids.length; index += batchSize) {
    const batch = target.productGids.slice(index, index + batchSize);
    const result = await publishProductBatch(batch, publication.id);

    failures.push(...result.failures);
    publishedCount += result.publishedCount;
    console.log(
      `Batch ${Math.floor(index / batchSize) + 1}: ${result.publishedCount}/${batch.length} pubblicati.`,
    );
  }

  if (failures.length > 0) {
    console.error(JSON.stringify({ failures }, null, 2));
    throw new Error(
      `Pubblicazione incompleta: ${failures.length} prodotti con errore.`,
    );
  }

  console.log(`Pubblicazione completata: ${publishedCount} prodotti.`);
}

async function findPublicationByTitle(title) {
  const query = `query SyncBayFindPublication {
    publications(first: 100) {
      nodes {
        id
        catalog {
          title
        }
      }
    }
  }`;
  const { stdout } = await execFileAsync(
    "shopify",
    [
      "store",
      "execute",
      "--store",
      shopDomain,
      "--version",
      SHOPIFY_API_VERSION,
      "--json",
      "--query",
      query,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...SHOPIFY_AGENT_ENV },
      maxBuffer: 1024 * 1024 * 5,
      timeout: 60_000,
    },
  );
  const parsed = JSON.parse(stdout.slice(findJsonStart(stdout)));
  const publications = parsed.publications?.nodes ?? [];

  return (
    publications
      .map((publication) => ({
        id: publication.id,
        title: publication.catalog?.title ?? publication.id,
      }))
      .find((publication) => publication.title === title) ?? null
  );
}

async function loadTargetProducts() {
  const sql = `
select jsonb_build_object(
  'shopId', s.id,
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

  return {
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

async function publishProductBatch(productGids, publicationId) {
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
  const { stdout } = await execFileAsync(
    "shopify",
    [
      "store",
      "execute",
      "--store",
      shopDomain,
      "--version",
      SHOPIFY_API_VERSION,
      "--json",
      "--allow-mutations",
      "--query",
      mutation,
      "--variables",
      JSON.stringify(variables),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...SHOPIFY_AGENT_ENV },
      maxBuffer: 1024 * 1024 * 20,
      timeout: 120_000,
    },
  );
  const parsed = JSON.parse(stdout.slice(findJsonStart(stdout)));
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
