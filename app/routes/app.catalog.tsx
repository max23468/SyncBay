import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
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
      <div className="syncbay-page syncbay-stack">
        <s-section heading="Prodotti collegati">
          <p className="syncbay-section-intro">
            Origine catalogo: eBay. Qui controlli i prodotti Shopify già
            collegati, senza modificare schede o creare un flusso inverso.
          </p>
          <div className="syncbay-metric-grid syncbay-metric-grid--compact">
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
          </div>
        </s-section>

        <s-section heading="Controllo catalogo">
          <FilterNav activeFilter={activeFilter} />
          {rows.length > 0 ? (
            <div className="syncbay-table-wrap">
              <table className="syncbay-table">
                <thead>
                  <tr>
                    <th scope="col">Prodotto</th>
                    <th scope="col">Collegamento</th>
                    <th className="syncbay-table__number" scope="col">
                      Disponibilità
                    </th>
                    <th className="syncbay-table__number" scope="col">
                      Prezzo
                    </th>
                    <th scope="col">Aggiornamento</th>
                    <th scope="col">Stato</th>
                    <th scope="col">Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <CatalogTableRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
              <CatalogPagination
                activeFilter={activeFilter}
                catalog={catalog}
              />
            </div>
          ) : (
            <EmptyCatalogState activeFilter={activeFilter} />
          )}
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

function CatalogTableRow({ row }: { row: CatalogRow }) {
  return (
    <tr>
      <td>
        <div className="syncbay-product-cell">
          <ProductThumbnail row={row} />
          <div>
            <p className="syncbay-product-cell__title">{row.title}</p>
            <p className="syncbay-product-cell__meta">
              SKU {row.sku ?? "non letto"} · ItemID {row.ebayItemId}
            </p>
          </div>
        </div>
      </td>
      <td>
        <span>Collegato a eBay</span>
        <span className="syncbay-table__subtext">
          {row.shopifyProductGid
            ? "Prodotto Shopify collegato"
            : "Prodotto Shopify non collegato"}
        </span>
      </td>
      <td className="syncbay-table__number">
        <span>{getCatalogAvailabilityLabel(row.availability)}</span>
        <span className="syncbay-table__subtext">
          {row.quantity === null ? "Quantità non letta" : `${row.quantity} pz`}
        </span>
      </td>
      <td className="syncbay-table__number">
        {row.price
          ? `${row.price.amount} ${row.price.currency ?? ""}`
          : "Non letto"}
      </td>
      <td>
        <span>{formatDateTime(row.lastSyncedAt)}</span>
        <span className="syncbay-table__subtext">
          Snapshot {formatDateTime(row.snapshotCapturedAt)}
        </span>
      </td>
      <td>
        <span className={`syncbay-badge syncbay-badge--${getStatusTone(row)}`}>
          {getCatalogStatusLabel(row.status)}
        </span>
      </td>
      <td>
        {row.openConflictCount > 0 ? (
          <s-button href="/app/conflicts?filter=open">Risolvi</s-button>
        ) : (
          <details className="syncbay-row-details">
            <summary>Dettagli</summary>
            <p>
              Stato mapping: {row.mappingStatus}.{" "}
              {row.lastErrorMessage
                ? `Ultimo errore: ${row.lastErrorMessage}`
                : "Nessun errore recente."}
            </p>
          </details>
        )}
      </td>
    </tr>
  );
}

function FilterNav({ activeFilter }: { activeFilter: CatalogPageFilter }) {
  return (
    <nav aria-label="Filtri catalogo" className="syncbay-filter-nav">
      {CATALOG_FILTERS.map((filter) => (
        <a
          aria-current={activeFilter === filter.value ? "page" : undefined}
          className="syncbay-filter-nav__item"
          href={getCatalogHref(filter.value)}
          key={filter.value}
        >
          {filter.label}
        </a>
      ))}
    </nav>
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
    <div className="syncbay-pagination">
      <p className="syncbay-section-intro">
        Mostrati {formatNumber(pagination.currentStart)}-
        {formatNumber(pagination.currentEnd)} di{" "}
        {formatNumber(pagination.totalRows)} risultati
        {activeFilter === "all" ? "" : " per questo filtro"}. Catalogo totale:{" "}
        {formatNumber(catalog.summary.totalCount)}.
      </p>
      {pagination.cappedAtMaxProducts ? (
        <p className="syncbay-section-intro">
          SyncBay carica al massimo {formatNumber(pagination.maxProducts)}{" "}
          mapping per questa vista. Il resto del catalogo resta preservato e
          verrà incluso quando la paginazione estesa sarà attiva.
        </p>
      ) : null}
      <div className="syncbay-inline-actions">
        {pagination.hasPreviousPage && pagination.previousPage ? (
          <s-button
            href={getCatalogHref(activeFilter, pagination.previousPage)}
          >
            Precedente
          </s-button>
        ) : null}
        <span className="syncbay-table__subtext">
          Pagina {formatNumber(pagination.page)} di{" "}
          {formatNumber(pagination.totalPages)}
        </span>
        {pagination.hasNextPage && pagination.nextPage ? (
          <s-button href={getCatalogHref(activeFilter, pagination.nextPage)}>
            Successiva
          </s-button>
        ) : null}
      </div>
    </div>
  );
}

function ProductThumbnail({ row }: { row: CatalogRow }) {
  if (row.thumbnailUrl) {
    return (
      <img
        alt=""
        className="syncbay-thumbnail"
        loading="lazy"
        src={row.thumbnailUrl}
      />
    );
  }

  return (
    <span aria-hidden className="syncbay-thumbnail syncbay-thumbnail--empty" />
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
    <div className="syncbay-metric">
      <p className="syncbay-metric__label">{label}</p>
      <p className="syncbay-metric__value">{value}</p>
      <p className="syncbay-metric__detail">{detail}</p>
    </div>
  );
}

function EmptyCatalogState({
  activeFilter,
}: {
  activeFilter: CatalogPageFilter;
}) {
  if (activeFilter === "all") {
    return (
      <div className="syncbay-empty-state">
        <h2>Nessun prodotto collegato</h2>
        <p>
          Completa l&apos;importazione iniziale per creare i collegamenti tra
          inserzioni eBay e prodotti Shopify.
        </p>
        <s-button href="/app/import-preview" variant="primary">
          Apri importazione
        </s-button>
      </div>
    );
  }

  return (
    <div className="syncbay-empty-state">
      <h2>Nessun risultato per questo filtro</h2>
      <p>Prova con il filtro Tutti o torna alla Panoramica.</p>
      <s-button href="/app/catalog">Mostra tutti</s-button>
    </div>
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
