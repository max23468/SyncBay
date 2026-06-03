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
  getTimelineCategoryLabel,
  type TimelineCategoryKind,
} from "../lib/syncbay-ui-state";
import {
  getDashboardState,
  requestSyncJobRetry,
} from "../services/syncbay.server";
import { authenticate } from "../shopify.server";

type Activity = Awaited<ReturnType<typeof getDashboardState>>;
type ActivityJob = Activity["sync"]["lastJobs"][number];
type ActivityFilter = "all" | "audit" | "errors" | "import" | "stock" | "sync";
type ActivityRow = {
  category: TimelineCategoryKind | "AUDIT";
  detail: string;
  id: string;
  job?: ActivityJob;
  meta: string;
  timestamp: string;
  title: string;
  tone: "critical" | "info" | "success" | "warning";
  type: "audit" | "job";
};

type ActivityActionData = {
  intent: "retryJob";
  message: string;
  status: "queued";
};

const ACTIVITY_FILTERS: Array<{ label: string; value: ActivityFilter }> = [
  { label: "Tutte", value: "all" },
  { label: "Errori", value: "errors" },
  { label: "Importazioni", value: "import" },
  { label: "Aggiornamenti", value: "sync" },
  { label: "Disponibilità", value: "stock" },
  { label: "Audit", value: "audit" },
];

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

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

  return (
    <s-page heading="Attività">
      <div className="syncbay-page syncbay-stack">
        <s-section heading="Coda operativa">
          <p className="syncbay-section-intro">
            Qui controlli job, errori e audit recenti senza uscire dalla
            dashboard. La sorgente catalogo resta eBay; gli ordini Shopify
            aggiornano solo la disponibilità eBay.
          </p>
          <div className="syncbay-metric-grid syncbay-metric-grid--compact">
            <MetricCard
              detail="Job non ancora completati."
              label="In coda"
              value={formatNumber(activity.sync.pendingJobs)}
            />
            <MetricCard
              detail="Errori letti negli ultimi job."
              label="Errori recenti"
              value={formatNumber(failedJobs)}
            />
            <MetricCard
              detail="Eventi tecnici registrati."
              label="Audit"
              value={formatNumber(activity.audit.length)}
            />
            <MetricCard
              detail={getCatalogHealthDetail(activity)}
              label="Catalogo"
              value={getCatalogHealthLabel(activity)}
            />
          </div>
          {actionData ? (
            <p className="syncbay-section-intro">{actionData.message}</p>
          ) : null}
        </s-section>

        <s-section heading="Timeline">
          <ActivityFilterNav activeFilter={activeFilter} />
          {rows.length > 0 ? (
            <ul className="syncbay-activity-list">
              {rows.map((row) => (
                <ActivityTimelineRow
                  isSaving={isSaving}
                  key={row.id}
                  row={row}
                />
              ))}
            </ul>
          ) : (
            <div className="syncbay-empty-state">
              <h2>Nessuna attività per questo filtro</h2>
              <p>
                Torna a Tutte oppure avvia l&apos;importazione quando eBay e
                Shopify sono pronti.
              </p>
              <s-button href="/app/activity">Mostra tutte</s-button>
            </div>
          )}
        </s-section>

        <s-section heading="Controlli rapidi">
          <ul className="syncbay-status-list">
            <StatusRow
              detail={getCatalogHealthDetail(activity)}
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
              title="Runner incrementale"
            />
            <StatusRow
              detail={`${activity.conflicts.openCount} decisioni aperte nella coda conflitti.`}
              label={
                activity.conflicts.openCount > 0 ? "Da gestire" : "Pulito"
              }
              tone={activity.conflicts.openCount > 0 ? "warning" : "success"}
              title="Conflitti Shopify"
            />
          </ul>
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function ActivityTimelineRow({
  isSaving,
  row,
}: {
  isSaving: boolean;
  row: ActivityRow;
}) {
  const canRetry = row.job ? row.job.status === "FAILED" : false;

  return (
    <li className="syncbay-activity-row">
      <div>
        <p className="syncbay-activity-row__title">{row.title}</p>
        <p className="syncbay-activity-row__detail">{row.detail}</p>
        <p className="syncbay-activity-row__meta">
          {row.meta} · {formatDateTime(row.timestamp)}
        </p>
      </div>
      <div className="syncbay-activity-row__actions">
        <span className={`syncbay-badge syncbay-badge--${row.tone}`}>
          {getActivityToneLabel(row.tone)}
        </span>
        {canRetry && row.job ? (
          <Form method="post">
            <input type="hidden" name="intent" value="retryJob" />
            <input type="hidden" name="jobId" value={row.job.id} />
            <s-button type="submit" disabled={isSaving}>
              Riprova
            </s-button>
          </Form>
        ) : null}
      </div>
    </li>
  );
}

function ActivityFilterNav({ activeFilter }: { activeFilter: ActivityFilter }) {
  return (
    <nav aria-label="Filtri attività" className="syncbay-filter-nav">
      {ACTIVITY_FILTERS.map((filter) => (
        <a
          aria-current={activeFilter === filter.value ? "page" : undefined}
          className="syncbay-filter-nav__item"
          href={
            filter.value === "all"
              ? "/app/activity"
              : `/app/activity?filter=${filter.value}`
          }
          key={filter.value}
        >
          {filter.label}
        </a>
      ))}
    </nav>
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

function StatusRow({
  detail,
  label,
  title,
  tone,
}: {
  detail: string;
  label: string;
  title: string;
  tone: "critical" | "info" | "success" | "warning";
}) {
  return (
    <li className="syncbay-status-row">
      <div>
        <p className="syncbay-status-row__title">{title}</p>
        <p className="syncbay-status-row__detail">{detail}</p>
      </div>
      <span className={`syncbay-badge syncbay-badge--${tone}`}>{label}</span>
    </li>
  );
}

function buildActivityRows(activity: Activity): ActivityRow[] {
  const jobRows = activity.sync.lastJobs.map((job) => ({
    category: getTimelineCategoryFromJobType(job.type),
    detail: getJobDetail(job),
    id: `job-${job.id}`,
    job,
    meta: `${getTimelineCategoryLabel(getTimelineCategoryFromJobType(job.type))} · ${formatJobStatus(job.status)}`,
    timestamp: job.createdAt,
    title: getJobTitle(job.type),
    tone: getJobTone(job.status),
    type: "job" as const,
  }));
  const auditRows = activity.audit.map((event) => ({
    category: "AUDIT" as const,
    detail: event.message,
    id: `audit-${event.type}-${event.createdAt}`,
    meta: `Audit · ${event.type}`,
    timestamp: event.createdAt,
    title: "Evento SyncBay",
    tone: "info" as const,
    type: "audit" as const,
  }));

  return [...jobRows, ...auditRows].sort(
    (first, second) =>
      new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );
}

function filterActivityRows(rows: ActivityRow[], filter: ActivityFilter) {
  if (filter === "all") return rows;
  if (filter === "audit") return rows.filter((row) => row.type === "audit");
  if (filter === "errors") {
    return rows.filter((row) => row.tone === "critical");
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
    value === "audit" ||
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

function getJobTitle(type: string) {
  if (type === "IMPORT_CATALOG") return "Importazione catalogo";
  if (type === "SYNC_INCREMENTAL") return "Aggiornamento catalogo";
  if (type === "UPDATE_EBAY_STOCK") return "Disponibilità eBay";
  if (type === "DETECT_SHOPIFY_CHANGES") return "Modifica Shopify rilevata";
  if (type === "ARCHIVE_INACTIVE_LISTING") return "Archiviazione prodotto";

  return "Attività SyncBay";
}

function getJobDetail(job: ActivityJob) {
  const pieces = [
    `Stato: ${formatJobStatus(job.status)}`,
    `tentativi ${job.attempts}`,
    `prossima esecuzione ${formatDateTime(job.runAfter)}`,
  ];

  if (job.errorMessage) pieces.push(job.errorMessage);

  return `${pieces.join(". ")}.`;
}

function formatJobStatus(status: string) {
  if (status === "PENDING") return "In coda";
  if (status === "RUNNING") return "In corso";
  if (status === "SUCCEEDED") return "Completato";
  if (status === "FAILED") return "Errore";
  if (status === "RETRYING") return "Riproverà automaticamente";
  if (status === "CANCELLED") return "Annullato";

  return status;
}

function getJobTone(status: string): ActivityRow["tone"] {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RETRYING") return "warning";

  return "info";
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("it-IT").format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "non disponibile";

  return itDateTimeFormatter.format(new Date(value));
}
