import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  getConflictActionLabel,
  getConflictFieldLabel,
  getConflictImpactText,
  type ConflictResolution,
} from "../lib/syncbay-ui-state";
import { authenticate } from "../shopify.server";
import {
  getConflictsPageState,
  resolveSyncConflict,
} from "../services/syncbay.server";

type Conflicts = Awaited<ReturnType<typeof getConflictsPageState>>;
type ConflictRow = Conflicts["rows"][number];
type ConflictFilter = "all" | "open" | "resolved";

const CONFLICT_FILTERS: Array<{ label: string; value: ConflictFilter }> = [
  { label: "Aperti", value: "open" },
  { label: "Risolti", value: "resolved" },
  { label: "Tutti", value: "all" },
];

const CONFLICT_RESOLUTIONS: ConflictResolution[] = [
  "REALIGN_FROM_EBAY",
  "KEEP_SHOPIFY",
  "IGNORE_FIELD",
];

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

type ConflictActionData = {
  intent: "resolveConflict";
  message: string;
  status: "resolved";
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return getConflictsPageState(session);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const [{ session }, formData] = await Promise.all([
    authenticate.admin(request),
    request.formData(),
  ]);
  const conflictId = String(formData.get("conflictId") ?? "");
  const resolution = String(formData.get("resolution") ?? "");

  if (!conflictId) {
    throw new Response("Conflitto SyncBay mancante.", { status: 400 });
  }

  const result = await resolveSyncConflict(session, {
    conflictId,
    resolution,
  });

  return Response.json({
    intent: "resolveConflict",
    message: result.message,
    status: result.status,
  } satisfies ConflictActionData);
};

export default function ConflictsRoute() {
  const conflicts = useLoaderData<typeof loader>();
  const actionData = useActionData() as ConflictActionData | undefined;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const activeFilter = getConflictFilter(searchParams.get("filter"));
  const rows = filterConflictRows(conflicts.rows, activeFilter);
  const isSaving = navigation.state !== "idle";

  return (
    <s-page heading="Conflitti">
      <div className="syncbay-page syncbay-stack">
        <s-section heading="Decisioni aperte">
          <p className="syncbay-section-intro">
            SyncBay non sovrascrive modifiche Shopify senza conferma. Scegli
            quale valore mantenere per far ripartire l&apos;allineamento.
          </p>
          <div className="syncbay-metric-grid syncbay-metric-grid--compact">
            <MetricCard
              detail="Richiedono una scelta."
              label="Aperti"
              value={formatNumber(conflicts.summary.openCount)}
            />
            <MetricCard
              detail="Già gestiti o ignorati."
              label="Risolti"
              value={formatNumber(conflicts.summary.resolvedCount)}
            />
            <MetricCard
              detail="Nel periodo letto dalla dashboard."
              label="Totale"
              value={formatNumber(conflicts.summary.totalCount)}
            />
          </div>
          {actionData ? (
            <p className="syncbay-section-intro">{actionData.message}</p>
          ) : null}
        </s-section>

        <s-section heading="Coda conflitti">
          <FilterNav activeFilter={activeFilter} />
          {rows.length > 0 ? (
            <div className="syncbay-conflict-list">
              {rows.map((row) => (
                <ConflictItem
                  isSaving={isSaving}
                  key={row.id}
                  row={row}
                />
              ))}
            </div>
          ) : (
            <EmptyConflictState activeFilter={activeFilter} />
          )}
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function ConflictItem({
  isSaving,
  row,
}: {
  isSaving: boolean;
  row: ConflictRow;
}) {
  const isOpen = row.status === "OPEN";

  return (
    <article className="syncbay-conflict-item">
      <div className="syncbay-conflict-item__header">
        <div className="syncbay-product-cell">
          <ProductThumbnail row={row} />
          <div>
            <p className="syncbay-product-cell__title">{row.product.title}</p>
            <p className="syncbay-product-cell__meta">
              {row.product.sku ? `SKU ${row.product.sku} · ` : ""}
              {row.ebayItemId ? `ItemID ${row.ebayItemId}` : "Mapping assente"}
            </p>
          </div>
        </div>
        <span
          className={`syncbay-badge syncbay-badge--${isOpen ? "warning" : "info"}`}
        >
          {isOpen ? "Aperto" : "Risolto"}
        </span>
      </div>

      <div className="syncbay-conflict-item__body">
        <div>
          <p className="syncbay-conflict-item__label">Campo</p>
          <p>{getConflictFieldLabel(row.field)}</p>
        </div>
        <div>
          <p className="syncbay-conflict-item__label">Impatto</p>
          <p>{getConflictImpactText(row.field)}</p>
        </div>
        <div className="syncbay-conflict-comparison">
          <div>
            <p className="syncbay-conflict-item__label">Valore eBay</p>
            <p>{row.sourceValue}</p>
          </div>
          <div>
            <p className="syncbay-conflict-item__label">Valore Shopify</p>
            <p>{row.shopifyValue}</p>
          </div>
        </div>
      </div>

      <div className="syncbay-conflict-item__footer">
        <span className="syncbay-table__subtext">
          Rilevato {formatDateTime(row.detectedAt)}
          {row.resolvedAt ? ` · Risolto ${formatDateTime(row.resolvedAt)}` : ""}
        </span>
        {isOpen ? (
          <div className="syncbay-inline-actions">
            {CONFLICT_RESOLUTIONS.map((resolution) => (
              <ResolveConflictForm
                conflictId={row.id}
                disabled={isSaving}
                key={resolution}
                resolution={resolution}
              />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ResolveConflictForm({
  conflictId,
  disabled,
  resolution,
}: {
  conflictId: string;
  disabled: boolean;
  resolution: ConflictResolution;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="conflictId" value={conflictId} />
      <input type="hidden" name="resolution" value={resolution} />
      <s-button type="submit" disabled={disabled}>
        {getConflictActionLabel(resolution)}
      </s-button>
    </Form>
  );
}

function FilterNav({ activeFilter }: { activeFilter: ConflictFilter }) {
  return (
    <nav aria-label="Filtri conflitti" className="syncbay-filter-nav">
      {CONFLICT_FILTERS.map((filter) => (
        <a
          aria-current={activeFilter === filter.value ? "page" : undefined}
          className="syncbay-filter-nav__item"
          href={
            filter.value === "open"
              ? "/app/conflicts"
              : `/app/conflicts?filter=${filter.value}`
          }
          key={filter.value}
        >
          {filter.label}
        </a>
      ))}
    </nav>
  );
}

function ProductThumbnail({ row }: { row: ConflictRow }) {
  if (row.product.thumbnailUrl) {
    return (
      <img
        alt=""
        className="syncbay-thumbnail"
        loading="lazy"
        src={row.product.thumbnailUrl}
      />
    );
  }

  return <span aria-hidden className="syncbay-thumbnail syncbay-thumbnail--empty" />;
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

function EmptyConflictState({
  activeFilter,
}: {
  activeFilter: ConflictFilter;
}) {
  if (activeFilter === "open") {
    return (
      <div className="syncbay-empty-state">
        <h2>Nessun conflitto aperto</h2>
        <p>Le modifiche Shopify non richiedono decisioni in questo momento.</p>
        <s-button href="/app/catalog">Apri catalogo</s-button>
      </div>
    );
  }

  return (
    <div className="syncbay-empty-state">
      <h2>Nessun conflitto in questa vista</h2>
      <p>Prova con il filtro Tutti o torna ai conflitti aperti.</p>
      <s-button href="/app/conflicts">Mostra aperti</s-button>
    </div>
  );
}

function getConflictFilter(value: string | null): ConflictFilter {
  if (value === "all" || value === "resolved") return value;

  return "open";
}

function filterConflictRows(rows: ConflictRow[], filter: ConflictFilter) {
  if (filter === "resolved") {
    return rows.filter((row) => row.status !== "OPEN");
  }
  if (filter === "all") return rows;

  return rows.filter((row) => row.status === "OPEN");
}

function formatDateTime(value: string) {
  return itDateTimeFormatter.format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("it-IT").format(value);
}
