import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  type CatalogPageFilter,
  normalizeCatalogPage,
  normalizeCatalogPageFilter,
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
  { label: "Archiviati", value: "archived" },
];

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

export const meta: MetaFunction = () => getSyncBayMeta("Catalogo");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  return getCatalogPageState(session, {
    filter: normalizeCatalogPageFilter(url.searchParams.get("filter")),
    page: normalizeCatalogPage(url.searchParams.get("page")),
  });
};

export default function CatalogRoute() {
  const catalog = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const activeFilter = normalizeCatalogPageFilter(searchParams.get("filter"));
  const rows = catalog.rows;

  return (
    <s-page heading="Catalogo">
      <s-badge slot="accessory" tone="info">Origine eBay.it</s-badge>
      <s-stack gap="base">
        <s-section heading="Prodotti collegati">
          <s-text color="subdued">
            Origine catalogo: eBay.it. Shopify riceve un catalogo ordinato,
            con disponibilità protette e senza creare un flusso inverso.
          </s-text>
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(4, minmax(140px, 1fr))"
          >
            <MetricCard
              detail="Mapping eBay verso Shopify presenti."
              label="Totale"
              value={formatNumber(catalog.summary.totalCount)}
            />
            <MetricCard
              detail="Senza conflitti o ritardi evidenti."
              label="Aggiornati"
              value={formatNumber(catalog.summary.freshCount)}
            />
            <MetricCard
              detail="Richiedono controllo prima del prossimo allineamento."
              label="Da controllare"
              value={formatNumber(catalog.summary.needsCheckCount)}
            />
            <MetricCard
              detail="Prodotti non più attivi nel catalogo eBay."
              label="Archiviati"
              value={formatNumber(catalog.summary.archivedCount)}
            />
          </s-grid>
        </s-section>

        <s-section heading="Controllo catalogo">
          <FilterNav activeFilter={activeFilter} />
          {rows.length > 0 ? (
            <>
              <s-table>
                <s-table-header-row>
                  <s-table-header>Prodotto</s-table-header>
                  <s-table-header>Collegamento</s-table-header>
                  <s-table-header format="numeric">
                    Disponibilità
                  </s-table-header>
                  <s-table-header format="numeric">Prezzo</s-table-header>
                  <s-table-header>Aggiornamento</s-table-header>
                  <s-table-header>Stato</s-table-header>
                  <s-table-header>Azione</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rows.map((row) => (
                    <CatalogTableRow key={row.id} row={row} />
                  ))}
                </s-table-body>
              </s-table>
              <CatalogPagination
                activeFilter={activeFilter}
                catalog={catalog}
              />
            </>
          ) : (
            <EmptyCatalogState activeFilter={activeFilter} />
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

function CatalogTableRow({ row }: { row: CatalogRow }) {
  return (
    <s-table-row>
      <s-table-cell>
        <s-stack direction="inline" gap="base" alignItems="center">
          <ProductThumbnail row={row} />
          <s-stack gap="small-200">
            <s-text type="strong">{row.title}</s-text>
            <s-text color="subdued">
              SKU {row.sku ?? "non letto"} · ItemID {row.ebayItemId}
            </s-text>
          </s-stack>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-text>Collegato a eBay</s-text>
          <s-text color="subdued">
            {row.shopifyProductGid
              ? "Prodotto Shopify collegato"
              : "Prodotto Shopify non collegato"}
          </s-text>
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
      <s-table-cell>
        {row.price
          ? `${row.price.amount} ${row.price.currency ?? ""}`
          : "Non letto"}
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-text>{formatDateTime(row.lastSyncedAt)}</s-text>
          <s-text color="subdued">
            Snapshot {formatDateTime(row.snapshotCapturedAt)}
          </s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={getStatusTone(row)}>
          {getCatalogStatusLabel(row.status)}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        {row.openConflictCount > 0 ? (
          <s-button href="/app/conflicts?filter=open">Risolvi</s-button>
        ) : (
          <details className="syncbay-row-details">
            <summary>Dettagli</summary>
            <s-text>
              Stato mapping: {row.mappingStatus}.{" "}
              {row.lastErrorMessage
                ? `Ultimo errore: ${row.lastErrorMessage}`
                : "Nessun errore recente."}
            </s-text>
          </details>
        )}
      </s-table-cell>
    </s-table-row>
  );
}

function FilterNav({ activeFilter }: { activeFilter: CatalogPageFilter }) {
  return (
    <s-stack direction="inline" gap="small-200" accessibilityRole="navigation">
      {CATALOG_FILTERS.map((filter) => (
        <s-clickable-chip
          aria-current={activeFilter === filter.value ? "page" : undefined}
          color={activeFilter === filter.value ? "strong" : "base"}
          href={getCatalogHref(filter.value)}
          key={filter.value}
        >
          {filter.label}
        </s-clickable-chip>
      ))}
    </s-stack>
  );
}

function CatalogPagination({
  activeFilter,
  catalog,
}: {
  activeFilter: CatalogPageFilter;
  catalog: Catalog;
}) {
  const pagination = catalog.pagination;

  return (
    <s-stack gap="small-200">
      <s-text color="subdued">
        Mostrati {formatNumber(pagination.currentStart)}-
        {formatNumber(pagination.currentEnd)} di{" "}
        {formatNumber(pagination.totalRows)} risultati
        {activeFilter === "all" ? "" : " per questo filtro"}. Catalogo totale:{" "}
        {formatNumber(catalog.summary.totalCount)}.
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
            href={getCatalogHref(activeFilter, pagination.previousPage)}
          >
            Precedente
          </s-button>
        ) : null}
        <s-text color="subdued">
          Pagina {formatNumber(pagination.page)} di{" "}
          {formatNumber(pagination.totalPages)}
        </s-text>
        {pagination.hasNextPage && pagination.nextPage ? (
          <s-button href={getCatalogHref(activeFilter, pagination.nextPage)}>
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
    <s-box
      accessibilityVisibility="hidden"
      background="subdued"
      blockSize="64px"
      borderRadius="base"
      inlineSize="64px"
    />
  );
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        <s-text color="subdued">{detail}</s-text>
      </s-stack>
    </s-box>
  );
}

function EmptyCatalogState({
  activeFilter,
}: {
  activeFilter: CatalogPageFilter;
}) {
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

function getCatalogHref(filter: CatalogPageFilter, page = 1) {
  const params = new URLSearchParams();

  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));

  const query = params.toString();

  return query ? `/app/catalog?${query}` : "/app/catalog";
}

function getStatusTone(row: CatalogRow) {
  if (row.status === "active_fresh") return "success";
  if (row.status === "archived") return "info";
  if (row.status === "mapping_error") return "critical";

  return "warning";
}

function formatDateTime(value: string | null) {
  if (!value) return "Non ancora";

  return itDateTimeFormatter.format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("it-IT").format(value);
}
