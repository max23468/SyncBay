import type {
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";

import {
  EmptyState,
  MetricTile,
  PaginationNav,
  ProductThumbnail,
} from "../components/SyncBayUi";
import {
  type CatalogPageFilter,
  type CatalogSortDir,
  type CatalogSortKey,
  normalizeCatalogPage,
  normalizeCatalogPageFilter,
  normalizeCatalogSort,
  normalizeCatalogSortDir,
} from "../lib/syncbay-catalog-page";
import { embeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import { SYNCBAY_COPY } from "../lib/syncbay-copy";
import {
  formatItDateTime,
  formatItNumber as formatNumber,
} from "../lib/syncbay-datetime-format";
import {
  createSyncBayLoaderPerformanceTrace,
  logSyncBayLoaderPerformance,
} from "../lib/syncbay-loader-performance";
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

export const meta: MetaFunction = () => getSyncBayMeta("Catalogo");

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const trace = createSyncBayLoaderPerformanceTrace();
  const { session } = await trace.measure("auth.admin", () =>
    authenticate.admin(request),
  );
  const order = normalizeCatalogOrder(url.searchParams.get("order"));
  const filter = normalizeCatalogPageFilter(url.searchParams.get("filter"));
  const page = normalizeCatalogPage(url.searchParams.get("page"));
  const search = url.searchParams.get("q") ?? undefined;
  const sort = order?.sort ?? normalizeCatalogSort(url.searchParams.get("sort"));
  const sortDir =
    order?.sortDir ?? normalizeCatalogSortDir(url.searchParams.get("dir"));

  const catalog = await trace.measure("catalog.state", () =>
    getCatalogPageState(
      session,
      {
        filter,
        page,
        search,
        sort,
        sortDir,
      },
      trace,
    ),
  );

  logSyncBayLoaderPerformance({
    request,
    details: {
      filter,
      hasSearch: Boolean(search?.trim()),
      maxLoadedRows: catalog.pagination.maxLoadedRows,
      page,
      rows: catalog.rows.length,
      totalAvailableCount: catalog.pagination.totalAvailableCount,
    },
    payload: catalog,
    route: "catalog",
    trace,
  });

  return catalog;
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
        <div className="syncbay-balanced-box-grid">
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
        </div>

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
                <div className="syncbay-table-scroll syncbay-table-wrap">
                  <s-table>
                    <s-table-header-row>
                      <s-table-header listSlot="kicker">Immagine</s-table-header>
                      <SortableHeader
                        activeFilter={activeFilter}
                        activeSearch={activeSearch}
                        activeSort={activeSort}
                        activeSortDir={activeSortDir}
                        label="Prodotto"
                        listSlot="primary"
                        sortKey="product"
                      />
                      <s-table-header listSlot="inline">Collegamento</s-table-header>
                      <s-table-header format="numeric" listSlot="labeled">
                        Disponibilità
                      </s-table-header>
                      <SortableHeader
                        activeFilter={activeFilter}
                        activeSearch={activeSearch}
                        activeSort={activeSort}
                        activeSortDir={activeSortDir}
                        format="numeric"
                        label="Prezzo"
                        listSlot="inline"
                        sortKey="price"
                      />
                      <SortableHeader
                        activeFilter={activeFilter}
                        activeSearch={activeSearch}
                        activeSort={activeSort}
                        activeSortDir={activeSortDir}
                        label="Aggiornato"
                        listSlot="secondary"
                        sortKey="updated"
                      />
                      <SortableHeader
                        activeFilter={activeFilter}
                        activeSearch={activeSearch}
                        activeSort={activeSort}
                        activeSortDir={activeSortDir}
                        label="Stato"
                        listSlot="inline"
                        sortKey="status"
                      />
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
                </div>
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

export const headers = embeddedNoStoreHeaders;

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
        <ProductThumbnail thumbnailUrl={row.thumbnailUrl} />
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
            <s-button href="/app/activity?filter=errors">Vedi errori</s-button>
          ) : null}
          <s-button
            href={shopifyProductUrl ?? getEbayItemUrl(row.ebayItemId)}
            target="_blank"
          >
            {shopifyProductUrl ? "Apri in Shopify" : "Apri su eBay"}
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
              value={activeSearch}
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
    <PaginationNav
      getPageHref={(page) =>
        getCatalogHref(activeFilter, page, activeSort, activeSortDir, activeSearch)
      }
      note={
        pagination.cappedAtMaxProducts
          ? `SyncBay carica al massimo ${formatNumber(pagination.maxProducts)} mapping per questa vista. Il resto del catalogo resta preservato e verrà incluso quando la paginazione estesa sarà attiva.`
          : undefined
      }
      pagination={pagination}
      summary={`Mostrati ${formatNumber(pagination.currentStart)}-${formatNumber(
        pagination.currentEnd,
      )} di ${formatNumber(
        pagination.totalRows,
      )} risultati${resultQualifier}. Catalogo totale: ${formatNumber(
        catalog.summary.totalCount,
      )}.`}
    />
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
    const copy = SYNCBAY_COPY.emptyState.catalogSearch(activeSearch);

    return (
      <EmptyState
        actionHref="/app/catalog"
        actionLabel={copy.actionLabel}
        actionVariant="secondary"
        body={copy.body}
        icon="product"
        title={copy.title}
      />
    );
  }

  if (activeFilter === "all") {
    const copy = SYNCBAY_COPY.emptyState.catalogUnlinked;

    return (
      <EmptyState
        actionHref="/app/import-preview"
        actionLabel={copy.actionLabel}
        body={copy.body}
        icon="import"
        title={copy.title}
      />
    );
  }

  const copy = SYNCBAY_COPY.emptyState.catalogFilter;

  return (
    <EmptyState
      actionHref="/app/catalog"
      actionLabel={copy.actionLabel}
      actionVariant="secondary"
      body={copy.body}
      icon="product"
      title={copy.title}
    />
  );
}

// Direzione iniziale al primo clic su una colonna non ancora attiva: i dati
// più "interessanti" devono comparire per primi (recenti in alto per data,
// crescente per nome/prezzo). I clic successivi sulla stessa colonna invertono.
// Solo le colonne esposte come ordinabili nella tabella.
const SORT_DEFAULT_DIR = {
  price: "asc",
  product: "asc",
  status: "asc",
  updated: "desc",
} satisfies Partial<Record<CatalogSortKey, CatalogSortDir>>;

type SortableColumnKey = keyof typeof SORT_DEFAULT_DIR;

function SortableHeader({
  activeFilter,
  activeSearch,
  activeSort,
  activeSortDir,
  format,
  label,
  listSlot,
  sortKey,
}: {
  activeFilter: CatalogPageFilter;
  activeSearch: string;
  activeSort: CatalogSortKey | null;
  activeSortDir: CatalogSortDir;
  format?: "numeric";
  label: string;
  listSlot: "primary" | "inline" | "secondary";
  sortKey: SortableColumnKey;
}) {
  const active = activeSort === sortKey;
  const targetDir: CatalogSortDir = active
    ? activeSortDir === "asc"
      ? "desc"
      : "asc"
    : SORT_DEFAULT_DIR[sortKey];
  const indicator = !active ? "↕" : activeSortDir === "asc" ? "↑" : "↓";

  return (
    <s-table-header
      aria-sort={
        active ? (activeSortDir === "asc" ? "ascending" : "descending") : "none"
      }
      format={format}
      listSlot={listSlot}
    >
      <s-clickable
        href={getCatalogHref(activeFilter, 1, sortKey, targetDir, activeSearch)}
      >
        <span className="syncbay-th-sort">
          {label}
          <span
            aria-hidden="true"
            className={`syncbay-th-sort__arrow${
              active ? " syncbay-th-sort__arrow--active" : ""
            }`}
          >
            {indicator}
          </span>
        </span>
      </s-clickable>
    </s-table-header>
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

function formatPrice(price: { amount: string; currency: string | null } | null) {
  if (!price) return "Non letto";

  const amount = Number(price.amount);

  // Importo non numerico dal provider: mostralo com'è, senza inventare.
  if (!Number.isFinite(amount)) {
    return `${price.amount}${price.currency ? ` ${price.currency}` : ""}`;
  }

  try {
    return new Intl.NumberFormat(
      "it-IT",
      price.currency
        ? { currency: price.currency, style: "currency" }
        : { minimumFractionDigits: 2 },
    ).format(amount);
  } catch {
    // Codice valuta non ISO: numero localizzato + codice dichiarato.
    return `${new Intl.NumberFormat("it-IT", {
      minimumFractionDigits: 2,
    }).format(amount)} ${price.currency}`;
  }
}

function formatDateTime(value: string | null) {
  return formatItDateTime(value, "Non ancora");
}
