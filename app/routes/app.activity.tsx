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
  MetricTile,
  type SyncBayIcon,
  TimelineEvent,
} from "../components/SyncBayUi";
import { LiveSync, useActionToast } from "../components/SyncBayLive";
import { getEmbeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import { getSyncJobDiagnostic } from "../lib/syncbay-job-diagnostics";
import {
  formatSyncJobStatus as formatJobStatus,
  getActivityBadgeState,
  getConflictFieldLabel,
  getSyncJobTitle as getJobTitle,
  getSyncJobTone as getJobTone,
  getTimelineCategoryLabel,
  type TimelineCategoryKind,
} from "../lib/syncbay-ui-state";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import {
  getDashboardState,
  requestSyncJobRetry,
} from "../services/syncbay.server";
import { authenticate } from "../shopify.server";

type Activity = Awaited<ReturnType<typeof getDashboardState>>;
type ActivityConflict = Activity["conflicts"]["recent"][number];
type ActivityJob = Activity["sync"]["lastJobs"][number];
type ActivityFilter =
  | "all"
  | "conflicts"
  | "errors"
  | "import"
  | "stock"
  | "sync";
type ActivityRow = {
  category: TimelineCategoryKind | "AUDIT";
  conflict?: ActivityConflict;
  detail: string;
  id: string;
  job?: ActivityJob;
  meta: string;
  timestamp: string;
  title: string;
  tone: "critical" | "info" | "success" | "warning";
  type: "audit" | "conflict" | "job";
};

type ActivityActionData = {
  intent: "retryJob";
  message: string;
  status: "queued";
};

const ACTIVITY_FILTERS: Array<{ label: string; value: ActivityFilter }> = [
  { label: "Tutte", value: "all" },
  { label: "Importazioni", value: "import" },
  { label: "Aggiornamenti", value: "sync" },
  { label: "Disponibilità", value: "stock" },
  { label: "Conflitti", value: "conflicts" },
  { label: "Errori", value: "errors" },
];

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

export const meta: MetaFunction = () => getSyncBayMeta("Attività");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return getDashboardState(session);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const [{ session }, formData] = await Promise.all([
    authenticate.admin(request),
    request.formData(),
  ]);
  const intent = String(formData.get("intent") ?? "");

  if (intent === "retryJob") {
    const jobId = String(formData.get("jobId") ?? "");

    if (!jobId) {
      throw new Response("Job SyncBay mancante.", { status: 400 });
    }

    return Response.json({
      intent,
      ...(await requestSyncJobRetry(session, jobId)),
    } satisfies ActivityActionData);
  }

  throw new Response("Azione Attività non supportata.", { status: 400 });
};

export default function ActivityRoute() {
  const activity = useLoaderData<typeof loader>();
  const actionData = useActionData() as ActivityActionData | undefined;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const activeFilter = getActivityFilter(searchParams.get("filter"));
  const rows = filterActivityRows(buildActivityRows(activity), activeFilter);
  const isSaving = navigation.state !== "idle";
  const failedJobs = activity.sync.lastJobs.filter(
    (job) => job.status === "FAILED",
  ).length;
  const working =
    activity.sync.pendingJobs > 0 ||
    activity.sync.catalogHealth.activeIncrementalJobCount > 0 ||
    activity.sync.catalogHealth.status === "running";
  const badge = getActivityBadgeState({
    failedJobs,
    openConflictCount: activity.conflicts.openCount,
    working,
  });

  useActionToast(
    { data: actionData, state: navigation.state },
    (data) => ({ message: data.message }),
  );

  return (
    <s-page heading="Attività" inlineSize="large">
      <s-badge slot="accessory" tone={badge.tone}>
        {badge.label}
      </s-badge>
      <s-stack gap="large">
        <LiveSync working={working} />
        <s-text color="subdued">
          Tutto quello che SyncBay ha fatto e sta facendo: aggiornamenti, errori
          e note. Gli errori restano leggibili e, dove si può, riprovabili.
        </s-text>
        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
        >
          <MetricTile
            detail="Aggiornamenti non ancora completati."
            icon="refresh"
            label="In coda"
            tone={activity.sync.pendingJobs > 0 ? "info" : "neutral"}
            value={formatNumber(activity.sync.pendingJobs)}
          />
          <MetricTile
            detail="Errori letti negli ultimi aggiornamenti."
            icon="alert-triangle"
            label="Errori recenti"
            tone={failedJobs > 0 ? "critical" : "neutral"}
            value={formatNumber(failedJobs)}
          />
          <MetricTile
            detail="Note operative registrate."
            icon="clock"
            label="Eventi"
            tone="neutral"
            value={formatNumber(activity.audit.length)}
          />
          <MetricTile
            detail={getCatalogHealthDetail(activity)}
            icon="product"
            label="Catalogo"
            tone={getCatalogHealthTone(activity)}
            value={getCatalogHealthLabel(activity)}
          />
        </s-grid>

        <s-section heading="Timeline">
          <ActivityFilterNav activeFilter={activeFilter} />
          {rows.length > 0 ? (
            <ol className="syncbay-timeline">
              {rows.map((row, index) => (
                <ActivityTimelineRow
                  isLast={index === rows.length - 1}
                  isSaving={isSaving}
                  key={row.id}
                  row={row}
                />
              ))}
            </ol>
          ) : (
            <s-box border="base" borderColor="base" borderRadius="base" padding="base">
              <s-stack gap="base">
                <s-heading>Nessuna attività per questo filtro</s-heading>
                <s-text>
                  Torna a Tutte oppure avvia l&apos;importazione quando eBay e
                  Shopify sono pronti.
                </s-text>
                <s-button href="/app/activity">Mostra tutte</s-button>
              </s-stack>
            </s-box>
          )}
        </s-section>

        <s-section heading="Controlli rapidi">
          <s-stack gap="base">
            <StatusRow
              detail={getCatalogHealthDetail(activity)}
              icon="product"
              label={getCatalogHealthLabel(activity)}
              tone={getCatalogHealthTone(activity)}
              title="Aggiornamento catalogo"
            />
            <StatusRow
              detail={
                activity.sync.catalogHealth.activeIncrementalJobCount > 0
                  ? `${activity.sync.catalogHealth.activeIncrementalJobCount} job incrementali attivi.`
                  : "Nessun job incrementale attivo."
              }
              label={
                activity.sync.catalogHealth.activeIncrementalJobCount > 0
                  ? "In corso"
                  : "Fermo"
              }
              tone={
                activity.sync.catalogHealth.activeIncrementalJobCount > 0
                  ? "info"
                  : "success"
              }
              icon="refresh"
              title="Aggiornamento automatico"
            />
            <StatusRow
              detail={`${activity.conflicts.openCount} decisioni aperte nella coda conflitti.`}
              label={
                activity.conflicts.openCount > 0 ? "Da gestire" : "Pulito"
              }
              icon="alert-triangle"
              tone={activity.conflicts.openCount > 0 ? "warning" : "success"}
              title="Conflitti Shopify"
            />
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

function ActivityTimelineRow({
  isLast,
  isSaving,
  row,
}: {
  isLast: boolean;
  isSaving: boolean;
  row: ActivityRow;
}) {
  const diagnostic = row.job ? getSyncJobDiagnostic(row.job) : null;
  const canRetry = diagnostic?.retry.canRetry ?? false;

  return (
    <TimelineEvent icon={getActivityIcon(row)} isLast={isLast} tone={row.tone}>
      <div className="syncbay-activity-row">
        <s-stack gap="small-200">
          <s-text type="strong">{row.title}</s-text>
          <s-text>{row.detail}</s-text>
          <s-text color="subdued">
            {row.meta} · {formatDateTime(row.timestamp)}
          </s-text>
          {row.job && diagnostic ? (
            <ActivityTechnicalDetails
              diagnostic={diagnostic}
              job={row.job}
            />
          ) : null}
        </s-stack>
        <div className="syncbay-activity-row__status">
          <span className="syncbay-activity-badge">
            <s-badge tone={row.tone}>{getActivityToneLabel(row.tone)}</s-badge>
          </span>
          {canRetry && row.job ? (
            <Form method="post">
              <input type="hidden" name="intent" value="retryJob" />
              <input type="hidden" name="jobId" value={row.job.id} />
              <s-button type="submit" disabled={isSaving}>
                {diagnostic?.retry.label ?? "Riprova"}
              </s-button>
            </Form>
          ) : row.job && diagnostic ? (
            <s-text color="subdued">{diagnostic.retry.label}</s-text>
          ) : null}
        </div>
      </div>
    </TimelineEvent>
  );
}

function getActivityIcon(row: ActivityRow): SyncBayIcon {
  if (row.tone === "critical") return "alert-triangle";
  if (row.tone === "success") return "check-circle";
  if (row.category === "IMPORT_CATALOG") return "import";
  if (row.category === "UPDATE_EBAY_STOCK") return "inventory";
  if (row.category === "CONFLICT") return "alert-circle";
  if (row.category === "AUDIT") return "clock";

  return "refresh";
}

function ActivityFilterNav({ activeFilter }: { activeFilter: ActivityFilter }) {
  return (
    <div className="syncbay-activity-filter-nav">
      <s-stack direction="inline" gap="small-200" accessibilityRole="navigation">
        {ACTIVITY_FILTERS.map((filter) => (
          <s-clickable-chip
            aria-current={activeFilter === filter.value ? "page" : undefined}
            color={activeFilter === filter.value ? "strong" : "base"}
            href={
              filter.value === "all"
                ? "/app/activity"
                : `/app/activity?filter=${filter.value}`
            }
            key={filter.value}
          >
            {filter.label}
          </s-clickable-chip>
        ))}
      </s-stack>
    </div>
  );
}

function StatusRow({
  detail,
  icon,
  label,
  title,
  tone,
}: {
  detail: string;
  icon: SyncBayIcon;
  label: string;
  title: string;
  tone: "critical" | "info" | "success" | "warning";
}) {
  return (
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack
        direction="inline"
        gap="base"
        justifyContent="space-between"
        alignItems="center"
      >
        <s-stack direction="inline" gap="base" alignItems="center">
          <span className="syncbay-tile__icon">
            <s-icon type={icon} tone="neutral" size="base" />
          </span>
          <s-stack gap="small-200">
            <s-heading>{title}</s-heading>
            <s-text color="subdued">{detail}</s-text>
          </s-stack>
        </s-stack>
        <span className="syncbay-activity-badge">
          <s-badge tone={tone}>{label}</s-badge>
        </span>
      </s-stack>
    </s-box>
  );
}

function buildActivityRows(activity: Activity): ActivityRow[] {
  const jobRows = activity.sync.lastJobs.map((job) => {
    const category = getTimelineCategoryFromJobType(job.type);
    const diagnostic = getSyncJobDiagnostic(job);

    return {
      category,
      detail: getJobDetail(job, diagnostic),
      id: `job-${job.id}`,
      job,
      meta: `${getTimelineCategoryLabel(category)} · ${formatJobStatus(job.status)}`,
      timestamp: job.createdAt,
      title: getJobTitle(job.type),
      tone: getJobTone(job.status),
      type: "job" as const,
    };
  });
  const auditRows = activity.audit.map((event) => ({
    category: "AUDIT" as const,
    detail: event.message,
    id: `audit-${event.type}-${event.createdAt}`,
    meta: "Sistema",
    timestamp: event.createdAt,
    title: "Nota operativa",
    tone: "info" as const,
    type: "audit" as const,
  }));
  const conflictRows = activity.conflicts.recent.map((conflict) => ({
    category: "CONFLICT" as const,
    conflict,
    detail: conflict.ebayItemId
      ? `ItemID ${conflict.ebayItemId} richiede una decisione prima del prossimo allineamento.`
      : "Un prodotto collegato richiede una decisione prima del prossimo allineamento.",
    id: `conflict-${conflict.id}`,
    meta: `${getTimelineCategoryLabel("CONFLICT")} · Aperto`,
    timestamp: conflict.detectedAt,
    title: `Conflitto ${getConflictFieldLabel(conflict.field)}`,
    tone: "warning" as const,
    type: "conflict" as const,
  }));

  return [...jobRows, ...conflictRows, ...auditRows].sort(
    (first, second) =>
      new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );
}

function filterActivityRows(rows: ActivityRow[], filter: ActivityFilter) {
  if (filter === "all") return rows;
  if (filter === "errors") {
    return rows.filter((row) => row.tone === "critical");
  }
  if (filter === "conflicts") {
    return rows.filter((row) => row.category === "CONFLICT");
  }
  if (filter === "import") {
    return rows.filter((row) => row.category === "IMPORT_CATALOG");
  }
  if (filter === "stock") {
    return rows.filter((row) => row.category === "UPDATE_EBAY_STOCK");
  }

  return rows.filter((row) => row.category === "SYNC_INCREMENTAL");
}

function getActivityFilter(value: string | null): ActivityFilter {
  if (
    value === "conflicts" ||
    value === "errors" ||
    value === "import" ||
    value === "stock" ||
    value === "sync"
  ) {
    return value;
  }

  return "all";
}

function getTimelineCategoryFromJobType(type: string): TimelineCategoryKind {
  if (type === "IMPORT_CATALOG") return "IMPORT_CATALOG";
  if (type === "UPDATE_EBAY_STOCK") return "UPDATE_EBAY_STOCK";
  if (
    type === "SYNC_INCREMENTAL" ||
    type === "DETECT_SHOPIFY_CHANGES" ||
    type === "ARCHIVE_INACTIVE_LISTING"
  ) {
    return "SYNC_INCREMENTAL";
  }

  return "FAILED_JOB";
}

function getJobDetail(
  job: ActivityJob,
  diagnostic: ReturnType<typeof getSyncJobDiagnostic>,
) {
  const pieces = [diagnostic.impact, diagnostic.nextAction];

  return `${pieces.flatMap((piece) => {
    const fragment = formatSentenceFragment(piece);

    return fragment ? [fragment] : [];
  }).join(". ")}.`;
}

function ActivityTechnicalDetails({
  diagnostic,
  job,
}: {
  diagnostic: ReturnType<typeof getSyncJobDiagnostic>;
  job: ActivityJob;
}) {
  return (
    <details className="syncbay-row-details syncbay-activity-details">
      <summary>Dettagli tecnici</summary>
      <s-unordered-list>
        <s-list-item>Tipo job: {job.type}</s-list-item>
        <s-list-item>Codice: {diagnostic.technicalReference}</s-list-item>
        <s-list-item>
          Tentativi: {job.attempts}/{job.maxAttempts}
        </s-list-item>
        <s-list-item>
          Prossima esecuzione: {formatDateTime(job.runAfter)}
        </s-list-item>
        <s-list-item>Retry: {diagnostic.retry.reason}</s-list-item>
        {job.errorMessage ? (
          <s-list-item>Errore: {job.errorMessage}</s-list-item>
        ) : null}
      </s-unordered-list>
    </details>
  );
}

function formatSentenceFragment(value: string) {
  return value.trim().replace(/[.!?]+$/u, "");
}

function getActivityToneLabel(tone: ActivityRow["tone"]) {
  if (tone === "success") return "Ok";
  if (tone === "critical") return "Errore";
  if (tone === "warning") return "Attenzione";

  return "Info";
}

function getCatalogHealthLabel(activity: Activity) {
  const status = activity.sync.catalogHealth.status;

  if (status === "disabled") return "Non attivo";
  if (status === "due") return "Da eseguire";
  if (status === "fresh") return "Aggiornato";
  if (status === "overdue") return "In ritardo";
  if (status === "running") return "In corso";

  return "Da controllare";
}

function getCatalogHealthTone(activity: Activity): ActivityRow["tone"] {
  const status = activity.sync.catalogHealth.status;

  if (status === "fresh") return "success";
  if (status === "overdue") return "warning";
  if (status === "disabled") return "info";

  return "info";
}

function getCatalogHealthDetail(activity: Activity) {
  const latest = activity.sync.catalogHealth.latestIncrementalFinishedAt;
  const next = activity.sync.catalogHealth.nextDueAt;

  if (latest && next) {
    return `Ultimo aggiornamento ${formatDateTime(latest)}, prossimo controllo ${formatDateTime(next)}.`;
  }

  if (latest) return `Ultimo aggiornamento ${formatDateTime(latest)}.`;
  if (next) return `Prossimo controllo ${formatDateTime(next)}.`;

  return "Nessun aggiornamento incrementale completato.";
}

const itNumberFormatter = new Intl.NumberFormat("it-IT");

function formatNumber(value: number) {
  return itNumberFormatter.format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "non disponibile";

  return itDateTimeFormatter.format(new Date(value));
}
