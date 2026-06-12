import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
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
  EbayMark,
  MetricTile,
  ShopifyMark,
  StatusHero,
} from "../components/SyncBayUi";
import {
  getConflictActionLabel,
  getConflictFieldLabel,
  getConflictImpactText,
  type ConflictResolution,
} from "../lib/syncbay-ui-state";
import {
  getConflictDecisionModeDetail,
  getConflictDecisionModeLabel,
  getConflictFieldDecisionMode,
  getConflictResolutionSafety,
} from "../lib/syncbay-conflict-actions";
import { getEmbeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import {
  type ConflictFilter,
  normalizeConflictFilter,
} from "../lib/syncbay-conflicts-page";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import { normalizePage } from "../lib/syncbay-pagination";
import { authenticate } from "../shopify.server";
import {
  getConflictsPageState,
  resolveSyncConflict,
} from "../services/syncbay.server";

type Conflicts = Awaited<ReturnType<typeof getConflictsPageState>>;
type ConflictRow = Conflicts["rows"][number];

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

export const meta: MetaFunction = () => getSyncBayMeta("Conflitti");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  return getConflictsPageState(session, {
    filter: normalizeConflictFilter(url.searchParams.get("filter")),
    page: normalizePage(url.searchParams.get("page")),
  });
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
  const activeFilter = normalizeConflictFilter(searchParams.get("filter"));
  const rows = conflicts.rows;
  const isSaving = navigation.state !== "idle";
  const openCount = conflicts.summary.openCount;
  const hasOpen = openCount > 0;

  return (
    <s-page heading="Conflitti">
      <s-badge slot="accessory" tone="warning">Scelte esplicite</s-badge>
      <s-stack gap="large">
        <StatusHero
          body={
            hasOpen
              ? "Nessuna sovrascrittura silenziosa: SyncBay non modifica Shopify senza conferma. Scegli quale valore mantenere per far ripartire l'allineamento."
              : "Le modifiche Shopify non richiedono decisioni in questo momento: l'allineamento eBay verso Shopify prosegue senza attese."
          }
          eyebrow="Decisioni aperte"
          icon={hasOpen ? "alert-triangle" : "check-circle"}
          title={
            hasOpen
              ? `${formatNumber(openCount)} ${
                  openCount === 1 ? "conflitto da decidere" : "conflitti da decidere"
                }`
              : "Nessun conflitto in sospeso"
          }
          tone={hasOpen ? "warning" : "success"}
        />

        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
        >
          <MetricTile
            detail="Richiedono una scelta."
            icon="alert-triangle"
            label="Aperti"
            tone={hasOpen ? "warning" : "neutral"}
            value={formatNumber(conflicts.summary.openCount)}
          />
          <MetricTile
            detail="Solo descrizioni da mantenere su Shopify."
            icon="check-circle"
            label="Batch sicuri"
            tone={conflicts.summary.batchSafeCount > 0 ? "success" : "neutral"}
            value={formatNumber(conflicts.summary.batchSafeCount)}
          />
          <MetricTile
            detail="Titoli e immagini da rivedere prima di applicare in serie."
            icon="alert-circle"
            label="Da rivedere"
            tone={conflicts.summary.guardedCount > 0 ? "warning" : "neutral"}
            value={formatNumber(conflicts.summary.guardedCount)}
          />
          <MetricTile
            detail="Prezzi, quantità, stato, SKU o campi non classificati."
            icon="settings"
            label="Manuali"
            tone={conflicts.summary.manualOnlyCount > 0 ? "info" : "neutral"}
            value={formatNumber(conflicts.summary.manualOnlyCount)}
          />
          <MetricTile
            detail="Totale reale della coda conflitti."
            icon="inventory"
            label="Totale"
            tone="info"
            value={formatNumber(conflicts.summary.totalCount)}
          />
        </s-grid>
        {actionData ? (
          <s-text color="subdued">{actionData.message}</s-text>
        ) : null}

        <s-section heading="Coda conflitti">
          <FilterNav activeFilter={activeFilter} />
          {rows.length > 0 ? (
            <s-stack gap="base">
              {rows.map((row) => (
                <ConflictItem
                  isSaving={isSaving}
                  key={row.id}
                  row={row}
                />
              ))}
            </s-stack>
          ) : (
            <EmptyConflictState activeFilter={activeFilter} />
          )}
          <ConflictPagination
            activeFilter={activeFilter}
            conflicts={conflicts}
          />
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

function ConflictItem({
  isSaving,
  row,
}: {
  isSaving: boolean;
  row: ConflictRow;
}) {
  const isOpen = row.status === "OPEN";
  const decisionMode = getConflictFieldDecisionMode(row.field);
  const safetyTone = getDecisionModeTone(decisionMode);

  return (
    <div className={`syncbay-conflict syncbay-conflict--${safetyTone}`}>
      <s-stack gap="base">
        <s-stack
          direction="inline"
          gap="base"
          justifyContent="space-between"
          alignItems="start"
        >
          <s-stack direction="inline" gap="base" alignItems="center">
            <ProductThumbnail row={row} />
            <s-stack gap="small-200">
              <s-text type="strong">{row.product.title}</s-text>
              <s-text color="subdued">
                {row.product.sku ? `SKU ${row.product.sku} · ` : ""}
                {row.ebayItemId
                  ? `ItemID ${row.ebayItemId}`
                  : "Mapping assente"}
              </s-text>
            </s-stack>
          </s-stack>
          <s-badge tone={isOpen ? "warning" : "info"}>
            {isOpen ? "Aperto" : "Risolto"}
          </s-badge>
        </s-stack>

        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">{getConflictFieldLabel(row.field)}</s-text>
            <s-badge tone={safetyTone}>
              {getConflictDecisionModeLabel(decisionMode)}
            </s-badge>
          </s-stack>
          <s-text color="subdued">{getConflictImpactText(row.field)}</s-text>
          <s-text color="subdued">
            {getConflictDecisionModeDetail(row.field, decisionMode)}
          </s-text>
        </s-stack>

        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
        >
          <SourcePanel
            label="eBay · sorgente di verità"
            mark="ebay"
            truth
            value={row.sourceValue}
          />
          <SourcePanel
            label="Shopify · vetrina"
            mark="shopify"
            value={row.shopifyValue}
          />
        </s-grid>

        <s-stack
          direction="inline"
          gap="base"
          justifyContent="space-between"
          alignItems="center"
        >
          <s-text color="subdued">
            Rilevato {formatDateTime(row.detectedAt)}
            {row.resolvedAt
              ? ` · Risolto ${formatDateTime(row.resolvedAt)}`
              : ""}
          </s-text>
          {isOpen ? (
            <s-stack direction="inline" gap="small-200">
              {CONFLICT_RESOLUTIONS.map((resolution) => (
                <ResolveConflictForm
                  conflictId={row.id}
                  disabled={isSaving}
                  field={row.field}
                  isPrimary={resolution === "REALIGN_FROM_EBAY"}
                  key={resolution}
                  resolution={resolution}
                />
              ))}
            </s-stack>
          ) : null}
        </s-stack>
      </s-stack>
    </div>
  );
}

function SourcePanel({
  label,
  mark,
  truth = false,
  value,
}: {
  label: string;
  mark: "ebay" | "shopify";
  truth?: boolean;
  value: string;
}) {
  return (
    <div className={`syncbay-source${truth ? " syncbay-source--truth" : ""}`}>
      <span className="syncbay-source__head">
        <span className="syncbay-source__mark">
          {mark === "ebay" ? <EbayMark /> : <ShopifyMark />}
        </span>
        <s-text color="subdued" type="strong">{label}</s-text>
      </span>
      <s-text>{value}</s-text>
    </div>
  );
}

function ResolveConflictForm({
  conflictId,
  disabled,
  field,
  isPrimary,
  resolution,
}: {
  conflictId: string;
  disabled: boolean;
  field: string;
  isPrimary: boolean;
  resolution: ConflictResolution;
}) {
  const safety = getConflictResolutionSafety(field, resolution);

  return (
    <Form method="post">
      <input type="hidden" name="conflictId" value={conflictId} />
      <input type="hidden" name="resolution" value={resolution} />
      <s-stack gap="small-200" alignItems="start">
        <s-button
          type="submit"
          disabled={disabled}
          variant={isPrimary ? "primary" : undefined}
        >
          {getConflictActionLabel(resolution)}
        </s-button>
        <s-text color="subdued">{safety.label}</s-text>
      </s-stack>
    </Form>
  );
}

function FilterNav({ activeFilter }: { activeFilter: ConflictFilter }) {
  return (
    <s-stack direction="inline" gap="small-200" accessibilityRole="navigation">
      {CONFLICT_FILTERS.map((filter) => (
        <s-clickable-chip
          aria-current={activeFilter === filter.value ? "page" : undefined}
          color={activeFilter === filter.value ? "strong" : "base"}
          href={getConflictHref(filter.value)}
          key={filter.value}
        >
          {filter.label}
        </s-clickable-chip>
      ))}
    </s-stack>
  );
}

function ConflictPagination({
  activeFilter,
  conflicts,
}: {
  activeFilter: ConflictFilter;
  conflicts: Conflicts;
}) {
  const pagination = conflicts.pagination;

  if (pagination.totalRows === 0) return null;

  return (
    <s-stack gap="small-200">
      <s-text color="subdued">
        Mostrati {formatNumber(pagination.currentStart)}-
        {formatNumber(pagination.currentEnd)} di{" "}
        {formatNumber(pagination.totalRows)} risultati
        {activeFilter === "all" ? "" : " per questo filtro"}. Coda totale:{" "}
        {formatNumber(conflicts.summary.totalCount)}.
      </s-text>
      <s-stack direction="inline" gap="small-200">
        {pagination.hasPreviousPage && pagination.previousPage ? (
          <s-button
            href={getConflictHref(activeFilter, pagination.previousPage)}
          >
            Precedente
          </s-button>
        ) : null}
        <s-text color="subdued">
          Pagina {formatNumber(pagination.page)} di{" "}
          {formatNumber(pagination.totalPages)}
        </s-text>
        {pagination.hasNextPage && pagination.nextPage ? (
          <s-button href={getConflictHref(activeFilter, pagination.nextPage)}>
            Successiva
          </s-button>
        ) : null}
      </s-stack>
    </s-stack>
  );
}

function ProductThumbnail({ row }: { row: ConflictRow }) {
  if (row.product.thumbnailUrl) {
    return (
      <s-thumbnail
        alt=""
        size="large"
        src={row.product.thumbnailUrl}
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

function EmptyConflictState({
  activeFilter,
}: {
  activeFilter: ConflictFilter;
}) {
  if (activeFilter === "open") {
    return (
      <s-box border="base" borderColor="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading>Nessun conflitto aperto</s-heading>
          <s-text>
            Le modifiche Shopify non richiedono decisioni in questo momento.
          </s-text>
          <s-button href="/app/catalog">Apri catalogo</s-button>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack gap="base">
        <s-heading>Nessun conflitto in questa vista</s-heading>
        <s-text>Prova con il filtro Tutti o torna ai conflitti aperti.</s-text>
        <s-button href="/app/conflicts">Mostra aperti</s-button>
      </s-stack>
    </s-box>
  );
}

function getConflictHref(filter: ConflictFilter, page = 1) {
  const params = new URLSearchParams();

  if (filter !== "open") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));

  const queryString = params.toString();

  return queryString ? `/app/conflicts?${queryString}` : "/app/conflicts";
}

function formatDateTime(value: string) {
  return itDateTimeFormatter.format(new Date(value));
}

const itNumberFormatter = new Intl.NumberFormat("it-IT");

function formatNumber(value: number) {
  return itNumberFormatter.format(value);
}

function getDecisionModeTone(
  mode: ReturnType<typeof getConflictFieldDecisionMode>,
) {
  if (mode === "batch_safe") return "success";
  if (mode === "guarded") return "warning";

  return "critical";
}
