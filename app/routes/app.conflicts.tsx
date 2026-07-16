import type {
  ActionFunctionArgs,
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

import {
  EbayMark,
  EmptyState,
  MetricTile,
  PaginationNav,
  ProductThumbnail,
  RiskLens,
  ShopifyMark,
  StatusHero,
} from "../components/SyncBayUi";
import { useActionToast } from "../hooks/use-action-toast";
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
import { embeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import { SYNCBAY_COPY } from "../lib/syncbay-copy";
import {
  formatItDateTime as formatDateTime,
  formatItNumber as formatNumber,
} from "../lib/syncbay-datetime-format";
import {
  createSyncBayLoaderPerformanceTrace,
  logSyncBayLoaderPerformance,
} from "../lib/syncbay-loader-performance";
import {
  type ConflictFilter,
  normalizeConflictFilter,
} from "../lib/syncbay-conflicts-page";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import { normalizePage } from "../lib/syncbay-pagination";
import { authenticate } from "../shopify.server";
import {
  getConflictsPageState,
  resolveBatchSafeConflicts,
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

type ConflictActionData = {
  intent: "resolveBatchSafe" | "resolveConflict";
  message: string;
  status: "resolved";
};

export const meta: MetaFunction = () => getSyncBayMeta("Conflitti");

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const trace = createSyncBayLoaderPerformanceTrace();
  const { session } = await trace.measure("auth.admin", () =>
    authenticate.admin(request),
  );
  const filter = normalizeConflictFilter(url.searchParams.get("filter"));
  const page = normalizePage(url.searchParams.get("page"));

  const conflicts = await trace.measure("conflicts.state", () =>
    getConflictsPageState(
      session,
      {
        filter,
        page,
      },
      trace,
    ),
  );

  logSyncBayLoaderPerformance({
    request,
    details: {
      filter,
      filteredCount: conflicts.summary.filteredCount,
      openCount: conflicts.summary.openCount,
      page,
      rows: conflicts.rows.length,
    },
    payload: conflicts,
    route: "conflicts",
    trace,
  });

  return conflicts;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const [{ session }, formData] = await Promise.all([
    authenticate.admin(request),
    request.formData(),
  ]);
  const intent = String(formData.get("intent") ?? "resolveConflict");

  if (intent === "resolveBatchSafe") {
    const result = await resolveBatchSafeConflicts(session);

    return Response.json({
      intent: "resolveBatchSafe",
      message: result.message,
      status: "resolved",
    } satisfies ConflictActionData);
  }

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
  const safeCount = conflicts.summary.batchSafeCount;

  useActionToast(
    { data: actionData, state: navigation.state },
    (data) => ({ message: data.message }),
  );

  return (
    <s-page heading="Conflitti" inlineSize="large">
      <s-badge slot="accessory" tone={hasOpen ? "warning" : "success"}>
        {hasOpen ? "Scelte da fare" : "Tutto allineato"}
      </s-badge>
      <s-stack gap="large">
        <StatusHero
          body={
            hasOpen
              ? "SyncBay non modifica i tuoi prodotti su Shopify senza il tuo via libera. Scegli quale versione tenere e l'aggiornamento riparte."
              : "Per ora non c'è niente da decidere: eBay e Shopify restano allineati."
          }
          eyebrow="Decisioni da prendere"
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

        <div className="syncbay-balanced-box-grid">
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
          >
            <MetricTile
              detail="Aspettano una tua scelta."
              icon="alert-triangle"
              label="Aperti"
              tone={hasOpen ? "warning" : "neutral"}
              value={formatNumber(conflicts.summary.openCount)}
            />
            <MetricTile
              detail="Descrizioni che puoi sistemare tutte insieme, senza rischi."
              icon="check-circle"
              label="Sicuri"
              tone={conflicts.summary.batchSafeCount > 0 ? "success" : "neutral"}
              value={formatNumber(conflicts.summary.batchSafeCount)}
            />
            <MetricTile
              detail="Titoli e immagini: guardali prima di applicarli a tutti."
              icon="alert-circle"
              label="Da rivedere"
              tone={conflicts.summary.guardedCount > 0 ? "warning" : "neutral"}
              value={formatNumber(conflicts.summary.guardedCount)}
            />
            <MetricTile
              detail="Prezzo, quantità, stato o SKU: da decidere caso per caso."
              icon="settings"
              label="Da decidere"
              tone={conflicts.summary.manualOnlyCount > 0 ? "info" : "neutral"}
              value={formatNumber(conflicts.summary.manualOnlyCount)}
            />
            <MetricTile
              detail="Tutti i conflitti rilevati, aperti e già risolti."
              icon="inventory"
              label="Totale"
              tone="info"
              value={formatNumber(conflicts.summary.totalCount)}
            />
          </s-grid>
        </div>

        {hasOpen && safeCount > 0 ? (
          <RiskLens
            actions={
              <Form method="post">
                <input name="intent" type="hidden" value="resolveBatchSafe" />
                <s-button disabled={isSaving} type="submit" variant="primary">
                  {isSaving
                    ? "Applico..."
                    : safeCount === 1
                      ? "Applica al sicuro"
                      : `Applica ai ${formatNumber(safeCount)} sicuri`}
                </s-button>
              </Form>
            }
            body="Sono tutte descrizioni: SyncBay tiene la versione di Shopify come riferimento, senza toccare eBay. Le scelte delicate (titoli, immagini, prezzi) restano qui sotto, una per una."
            title={
              safeCount === 1
                ? "1 conflitto sicuro da sistemare in blocco"
                : `${formatNumber(safeCount)} conflitti sicuri da sistemare in blocco`
            }
            tone="success"
          />
        ) : null}

        <s-section heading="Conflitti da gestire">
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

export const headers = embeddedNoStoreHeaders;

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
            <ProductThumbnail thumbnailUrl={row.product.thumbnailUrl} />
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

        <div className="syncbay-balanced-box-grid">
        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
        >
          <SourcePanel
            label="eBay · versione di riferimento"
            mark="ebay"
            truth
            value={row.sourceValue}
          />
          <SourcePanel
            label="Shopify · versione in vetrina"
            mark="shopify"
            value={row.shopifyValue}
          />
        </s-grid>
        </div>

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
      <input type="hidden" name="intent" value="resolveConflict" />
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
    <div className="syncbay-conflict-filter-nav">
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
    </div>
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

  return (
    <PaginationNav
      getPageHref={(page) => getConflictHref(activeFilter, page)}
      pagination={pagination}
      summary={`Mostrati ${formatNumber(pagination.currentStart)}-${formatNumber(
        pagination.currentEnd,
      )} di ${formatNumber(pagination.totalRows)} risultati${
        activeFilter === "all" ? "" : " per questo filtro"
      }. In totale: ${formatNumber(conflicts.summary.totalCount)}.`}
    />
  );
}

function EmptyConflictState({
  activeFilter,
}: {
  activeFilter: ConflictFilter;
}) {
  if (activeFilter === "open") {
    const copy = SYNCBAY_COPY.emptyState.conflictsOpen;

    return (
      <EmptyState
        actionHref="/app/catalog"
        actionLabel={copy.actionLabel}
        actionVariant="secondary"
        body={copy.body}
        icon="check-circle"
        title={copy.title}
      />
    );
  }

  const copy = SYNCBAY_COPY.emptyState.conflictsFilter;

  return (
    <EmptyState
      actionHref="/app/conflicts"
      actionLabel={copy.actionLabel}
      actionVariant="secondary"
      body={copy.body}
      icon="alert-triangle"
      title={copy.title}
    />
  );
}

function getConflictHref(filter: ConflictFilter, page = 1) {
  const params = new URLSearchParams();

  if (filter !== "open") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));

  const queryString = params.toString();

  return queryString ? `/app/conflicts?${queryString}` : "/app/conflicts";
}

function getDecisionModeTone(
  mode: ReturnType<typeof getConflictFieldDecisionMode>,
) {
  if (mode === "batch_safe") return "success";
  if (mode === "guarded") return "warning";

  return "critical";
}
