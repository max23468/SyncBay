import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { MetricTile } from "../components/SyncBayUi";
import {
  type CatalogPageFilter,
  type CatalogSortDir,
  type CatalogSortKey,
  normalizeCatalogPage,
  normalizeCatalogPageFilter,
  normalizeCatalogSort,
  normalizeCatalogSortDir,
} from "../lib/syncbay-catalog-page";
import { getEmbeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import {
  getCatalogAvailabilityLabel,
  getCatalogStatusLabel,
} from "../lib/syncbay-ui-state";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import { authenticate } from "../shopify.server";
import { getCatalogPageState } from "../services/syncbay.server";

type Catalog = Awaited<ReturnType<typeof getCatalogPageState>>;
type CatalogRow = Catalog["rows"][number];

const CATALOG_FILTERS: Array<{ label: string; value: CatalogPageFilter }> = [
  { label: "Tutti", value: "all" },
  { label: "Collegati", value: "linked" },
  { label: "Aggiornati", value: "fresh" },
  { label: "Da controllare", value: "needs_check" },
  { label: "Conflitti", value: "conflicts" },
  { label: "Non aggiornati", value: "not_updated" },
  { label: "Esauriti", value: "archived" },
];

const CATALOG_ORDER_OPTIONS: Array<{
  label: string;
  sort: CatalogSortKey | null;
  sortDir: CatalogSortDir;
  value: string;
}> = [
  { label: "Predefinito", sort: null, sortDir: "asc", value: "" },
  {
    label: "Aggiornati",
    sort: "updated",
    sortDir: "desc",
    value: "updated:desc",
  },
  {
    label: "Criticità",
    sort: "status",
    sortDir: "asc",
    value: "status:asc",
  },
  {
    label: "Prodotto A-Z",
    sort: "product",
    sortDir: "asc",
    value: "product:asc",
  },
  {
    label: "Prezzo crescente",
    sort: "price",
    sortDir: "asc",
    value: "price:asc",
  },
];

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

export const meta: MetaFunction = () => getSyncBayMeta("Catalogo");

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const order = normalizeCatalogOrder(url.searchParams.get("order"));

  return getCatalogPageState(session, {
    filter: normalizeCatalogPageFilter(url.searchParams.get("filter")),
    page: normalizeCatalogPage(url.searchParams.get("page")),
    search: url.searchParams.get("q") ?? undefined,
    sort: order?.sort ?? normalizeCatalogSort(url.searchParams.get("sort")),
    sortDir: order?.sortDir ?? normalizeCatalogSortDir(url.searchParams.get("dir")),
  });
};

export default function CatalogRoute() {
  const catalog = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const activeOrder = normalizeCatalogOrder(searchParams.get("order"));
  const activeFilter = normalizeCatalogPageFilter(searchParams.get("filter"));
  const activeSort = activeOrder?.sort ?? normalizeCatalogSort(searchParams.get("sort"));
  const activeSortDir = activeOrder?.sortDir ?? normalizeCatalogSortDir(searchParams.get("dir"));
  const activeSearch = searchParams.get("q") ?? "";
  const rows = catalog.rows;
  const accessory = getCatalogAccessory(catalog);

  return (
    <s-page heading="Catalogo" inlineSize="large">
      <s-badge slot="accessory" tone={accessory.tone}>
        {accessory.label}
      </s-badge>
      <s-stack gap="large">
        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
        >
          <MetricTile
            detail="Prodotti eBay collegati a Shopify."
            icon="product"
            label="Totale"
            tone="info"
            value={formatNumber(catalog.summary.linkedCount)}
          />
          <MetricTile
            detail="Senza conflitti o ritardi evidenti."
            icon="check-circle"
            label="Aggiornati"
            tone="success"
            value={formatNumber(catalog.summary.freshCount)}
          />
          <MetricTile
            detail="Da controllare prima del prossimo allineamento."
            icon="alert-triangle"
            label="Da controllare"
            tone={catalog.summary.needsCheckCount > 0 ? "warning" : "neutral"}
            value={formatNumber(catalog.summary.needsCheckCount)}
          />
          <MetricTile
            detail="Listing eBay non più attivo: prodotto in vetrina come esaurito."
            icon="package"
            label="Esauriti"
            tone="neutral"
            value={formatNumber(catalog.summary.archivedCount)}
          />
        </s-grid>

        <s-section heading="Controllo catalogo">
          <s-stack gap="large">
            <CatalogViewControls
              activeFilter={activeFilter}
              activeSearch={activeSearch}
              activeSort={activeSort}
              activeSortDir={activeSortDir}
            />
            {rows.length > 0 ? (
              <s-stack gap="base">
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="kicker">Immagine</s-table-header>
                    <s-table-header listSlot="primary">Prodotto</s-table-header>
                    <s-table-header listSlot="inline">Collegamento</s-table-header>
                    <s-table-header format="numeric" listSlot="labeled">
                      Disponibilità
                    </s-table-header>
                    <s-table-header format="numeric" listSlot="inline">
                      Prezzo
                    </s-table-header>
                    <s-table-header listSlot="secondary">
                      Aggiornato
                    </s-table-header>
                    <s-table-header listSlot="inline">Stato</s-table-header>
                    <s-table-header listSlot="labeled">Azioni</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {rows.map((row) => (
                      <CatalogTableRow
                        key={row.id}
                        row={row}
                        shopDomain={catalog.shop.domain}
                      />
                    ))}
                  </s-table-body>
                </s-table>
                <CatalogPagination
                  activeFilter={activeFilter}
                  activeSearch={activeSearch}
                  activeSort={activeSort}
                  activeSortDir={activeSortDir}
                  catalog={catalog}
                />
              </s-stack>
            ) : (
              <EmptyCatalogState
                activeFilter={activeFilter}
                activeSearch={activeSearch}
              />
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

function CatalogTableRow({
  row,
  shopDomain,
}: {
  row: CatalogRow;
  shopDomain: string;
}) {
  const shopifyProductUrl = getShopifyProductAdminUrl(
    shopDomain,
    row.shopifyProductGid,
  );

  return (
    <s-table-row>
      <s-table-cell>
        <ProductThumbnail row={row} />
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-text type="strong">{row.title}</s-text>
          <s-text color="subdued">
            SKU {row.sku ?? "non letto"} · ItemID {row.ebayItemId}
          </s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          <s-button href={getEbayItemUrl(row.ebayItemId)} target="_blank">
            eBay
          </s-button>
          {shopifyProductUrl ? (
            <s-button href={shopifyProductUrl} target="_blank">
              Shopify
            </s-button>
          ) : (
            <s-text color="subdued">Shopify non collegato</s-text>
          )}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-text>{getCatalogAvailabilityLabel(row.availability)}</s-text>
          <s-text color="subdued">
            {row.quantity === null ? "Quantità non letta" : `${row.quantity} pz`}
          </s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>{formatPrice(row.price)}</s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-text>{formatDateTime(row.lastSyncedAt)}</s-text>
          <s-text color="subdued">
            Lettura eBay {formatDateTime(row.snapshotCapturedAt)}
          </s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-badge tone={getStatusTone(row)}>
            {getCatalogStatusLabel(row.status)}
          </s-badge>
          {row.lastErrorMessage ? (
            <s-text color="subdued">{row.lastErrorMessage}</s-text>
          ) : null}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200" alignItems="start">
          {row.openConflictCount > 0 ? (
            <s-button href="/app/conflicts?filter=open" variant="primary">
              Risolvi
            </s-button>
          ) : null}
          {row.status === "mapping_error" ? (
            <s-button href="/app/activity?filter=errors">Riprova</s-button>
          ) : null}
          <s-button
            href={shopifyProductUrl ?? getEbayItemUrl(row.ebayItemId)}
            target="_blank"
          >
            Dettagli
          </s-button>
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

function CatalogViewControls({
  activeFilter,
  activeSearch,
  activeSort,
  activeSortDir,
}: {
  activeFilter: CatalogPageFilter;
  activeSearch: string;
  activeSort: CatalogSortKey | null;
  activeSortDir: CatalogSortDir;
}) {
  const activeOrderValue = getCatalogOrderValue(activeSort, activeSortDir);

  return (
    <div className="syncbay-filter-nav">
      <s-stack gap="base">
        <Form action="/app/catalog" method="get">
          {activeFilter !== "all" ? (
            <input name="filter" type="hidden" value={activeFilter} />
          ) : null}
          {activeOrderValue ? (
            <input name="order" type="hidden" value={activeOrderValue} />
          ) : null}
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <s-text-field
              defaultValue={activeSearch}
              label="Cerca nel catalogo"
              name="q"
              placeholder="Titolo, SKU o ItemID eBay"
            />
            <s-button type="submit">Cerca</s-button>
            {activeSearch ? (
              <s-button
                href={getCatalogHref(activeFilter, 1, activeSort, activeSortDir, "")}
              >
                Azzera
              </s-button>
            ) : null}
          </s-stack>
        </Form>
        <s-stack
          direction="inline"
          gap="small-200"
          accessibilityRole="navigation"
        >
          {CATALOG_FILTERS.map((filter) => (
            <s-clickable-chip
              aria-current={activeFilter === filter.value ? "page" : undefined}
              color={activeFilter === filter.value ? "strong" : "base"}
              href={getCatalogHref(
                filter.value,
                1,
                activeSort,
                activeSortDir,
                activeSearch,
              )}
              key={filter.value}
            >
              {filter.label}
            </s-clickable-chip>
          ))}
        </s-stack>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text color="subdued">Ordine</s-text>
          {CATALOG_ORDER_OPTIONS.map((order) => (
            <s-clickable-chip
              aria-current={activeOrderValue === order.value ? "page" : undefined}
              color={activeOrderValue === order.value ? "strong" : "base"}
              href={getCatalogHref(
                activeFilter,
                1,
                order.sort,
                order.sortDir,
                activeSearch,
              )}
              key={order.value || "default"}
            >
              {order.label}
            </s-clickable-chip>
          ))}
        </s-stack>
      </s-stack>
    </div>
  );
}

function CatalogPagination({
  activeFilter,
  activeSearch,
  activeSort,
  activeSortDir,
  catalog,
}: {
  activeFilter: CatalogPageFilter;
  activeSearch: string;
  activeSort: CatalogSortKey | null;
  activeSortDir: CatalogSortDir;
  catalog: Catalog;
}) {
  const pagination = catalog.pagination;
  const resultQualifier = activeSearch
    ? ` per la ricerca «${activeSearch}»`
    : activeFilter === "all"
      ? ""
      : " per questo filtro";

  return (
    <s-stack gap="small-200">
      <s-text color="subdued">
        Mostrati {formatNumber(pagination.currentStart)}-
        {formatNumber(pagination.currentEnd)} di{" "}
        {formatNumber(pagination.totalRows)} risultati{resultQualifier}. Catalogo
        totale: {formatNumber(catalog.summary.totalCount)}.
      </s-text>
      {pagination.cappedAtMaxProducts ? (
        <s-text color="subdued">
          SyncBay carica al massimo {formatNumber(pagination.maxProducts)}{" "}
          mapping per questa vista. Il resto del catalogo resta preservato e
          verrà incluso quando la paginazione estesa sarà attiva.
        </s-text>
      ) : null}
      <s-stack direction="inline" gap="small-200">
        {pagination.hasPreviousPage && pagination.previousPage ? (
          <s-button
            href={getCatalogHref(activeFilter, pagination.previousPage, activeSort, activeSortDir, activeSearch)}
          >
            Precedente
          </s-button>
        ) : null}
        <s-text color="subdued">
          Pagina {formatNumber(pagination.page)} di{" "}
          {formatNumber(pagination.totalPages)}
        </s-text>
        {pagination.hasNextPage && pagination.nextPage ? (
          <s-button href={getCatalogHref(activeFilter, pagination.nextPage, activeSort, activeSortDir, activeSearch)}>
            Successiva
          </s-button>
        ) : null}
      </s-stack>
    </s-stack>
  );
}

function ProductThumbnail({ row }: { row: CatalogRow }) {
  if (row.thumbnailUrl) {
    return (
      <s-thumbnail
        alt=""
        size="large"
        src={row.thumbnailUrl}
      />
    );
  }

  return (
    <span aria-hidden="true" className="syncbay-product-placeholder">
      <s-icon type="image" tone="neutral" />
    </span>
  );
}

function getCatalogAccessory(catalog: Catalog): {
  label: string;
  tone: "critical" | "info" | "success" | "warning";
} {
  if (catalog.summary.conflictCount > 0) {
    return { label: "Da verificare", tone: "warning" };
  }
  if (catalog.summary.needsCheckCount > 0) {
    return { label: "Controlli aperti", tone: "warning" };
  }
  if (catalog.summary.linkedCount === 0) {
    return { label: "Importazione richiesta", tone: "info" };
  }

  return { label: "Catalogo aggiornato", tone: "success" };
}

function EmptyCatalogState({
  activeFilter,
  activeSearch,
}: {
  activeFilter: CatalogPageFilter;
  activeSearch: string;
}) {
  if (activeSearch) {
    return (
      <s-box border="base" borderColor="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading>Nessun prodotto per «{activeSearch}»</s-heading>
          <s-text>
            Controlla il testo o cerca per titolo, SKU o ItemID eBay.
          </s-text>
          <s-button href="/app/catalog" variant="primary">
            Azzera la ricerca
          </s-button>
        </s-stack>
      </s-box>
    );
  }

  if (activeFilter === "all") {
    return (
      <s-box border="base" borderColor="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading>Nessun prodotto collegato</s-heading>
          <s-text>
            Completa l&apos;importazione iniziale per creare i collegamenti tra
            inserzioni eBay e prodotti Shopify.
          </s-text>
          <s-button href="/app/import-preview" variant="primary">
            Apri importazione
          </s-button>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack gap="base">
        <s-heading>Nessun risultato per questo filtro</s-heading>
        <s-text>Prova con il filtro Tutti o torna alla Panoramica.</s-text>
        <s-button href="/app/catalog">Mostra tutti</s-button>
      </s-stack>
    </s-box>
  );
}

function getCatalogHref(
  filter: CatalogPageFilter,
  page = 1,
  sort: CatalogSortKey | null = null,
  sortDir: CatalogSortDir = "asc",
  search = "",
) {
  const params = new URLSearchParams();
  const orderValue = getCatalogOrderValue(sort, sortDir);

  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));
  if (orderValue) params.set("order", orderValue);
  if (!orderValue && sort) {
    params.set("sort", sort);
    params.set("dir", sortDir);
  }
  if (search.trim()) params.set("q", search.trim());

  const query = params.toString();

  return query ? `/app/catalog?${query}` : "/app/catalog";
}

function normalizeCatalogOrder(value: string | null | undefined) {
  if (!value) return null;

  return (
    CATALOG_ORDER_OPTIONS.find((option) => option.value === value) ?? null
  );
}

function getCatalogOrderValue(
  sort: CatalogSortKey | null,
  sortDir: CatalogSortDir,
) {
  return (
    CATALOG_ORDER_OPTIONS.find(
      (option) => option.sort === sort && option.sortDir === sortDir,
    )?.value ?? ""
  );
}

function getStatusTone(row: CatalogRow) {
  if (row.status === "active_fresh") return "success";
  if (row.status === "archived") return "info";
  if (row.status === "mapping_error") return "critical";

  return "warning";
}

function getEbayItemUrl(ebayItemId: string) {
  return `https://www.ebay.it/itm/${encodeURIComponent(ebayItemId)}`;
}

function getShopifyProductAdminUrl(
  shopDomain: string,
  shopifyProductGid: string | null,
) {
  const productId = shopifyProductGid?.split("/").at(-1);

  if (!productId) return null;

  const shopHandle = shopDomain.replace(/\.myshopify\.com$/u, "");

  return `https://admin.shopify.com/store/${shopHandle}/products/${productId}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  GBP: "£",
  USD: "$",
};

function formatPrice(price: { amount: string; currency: string | null } | null) {
  if (!price) return "Non letto";

  const symbol = price.currency ? CURRENCY_SYMBOLS[price.currency] : null;

  if (symbol) return `${price.amount} ${symbol}`;

  return `${price.amount}${price.currency ? ` ${price.currency}` : ""}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Non ancora";

  return itDateTimeFormatter.format(new Date(value));
}

const itNumberFormatter = new Intl.NumberFormat("it-IT");

function formatNumber(value: number) {
  return itNumberFormatter.format(value);
}
