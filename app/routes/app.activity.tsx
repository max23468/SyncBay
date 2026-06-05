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

import { getEmbeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import { getSyncJobDiagnostic } from "../lib/syncbay-job-diagnostics";
import {
  getConflictFieldLabel,
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

  return (
    <s-page heading="Attività">
      <s-badge slot="accessory" tone="info">Diagnostica guidata</s-badge>
      <s-stack gap="base">
        <s-section heading="Coda operativa">
          <s-text color="subdued">
            Qui controlli attività, errori e note operative senza uscire
            dall&apos;app. La sorgente catalogo resta eBay; gli ordini Shopify
            aggiornano solo la disponibilità eBay. Gli errori restano leggibili
            e riprovabili dove possibile.
          </s-text>
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(4, minmax(140px, 1fr))"
          >
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
              detail="Note operative registrate."
              label="Eventi"
              value={formatNumber(activity.audit.length)}
            />
            <MetricCard
              detail={getCatalogHealthDetail(activity)}
              label="Catalogo"
              value={getCatalogHealthLabel(activity)}
            />
          </s-grid>
          {actionData ? (
            <s-text color="subdued">{actionData.message}</s-text>
          ) : null}
        </s-section>

        <s-section heading="Timeline">
          <ActivityFilterNav activeFilter={activeFilter} />
          {rows.length > 0 ? (
            <s-stack gap="base">
              {rows.map((row) => (
                <ActivityTimelineRow
                  isSaving={isSaving}
                  key={row.id}
                  row={row}
                />
              ))}
            </s-stack>
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
  isSaving,
  row,
}: {
  isSaving: boolean;
  row: ActivityRow;
}) {
  const diagnostic = row.job ? getSyncJobDiagnostic(row.job) : null;
  const canRetry = diagnostic?.retry.canRetry ?? false;

  return (
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack direction="inline" gap="base" justifyContent="space-between">
        <s-stack gap="small-200">
          <s-heading>{row.title}</s-heading>
          <s-text>{row.detail}</s-text>
          <s-text color="subdued">
            {row.meta} · {formatDateTime(row.timestamp)}
          </s-text>
        </s-stack>
        <s-stack gap="small-200" alignItems="end">
          <s-badge tone={row.tone}>{getActivityToneLabel(row.tone)}</s-badge>
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
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function ActivityFilterNav({ activeFilter }: { activeFilter: ActivityFilter }) {
  return (
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
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack direction="inline" gap="base" justifyContent="space-between">
        <s-stack gap="small-200">
          <s-heading>{title}</s-heading>
          <s-text color="subdued">{detail}</s-text>
        </s-stack>
        <s-badge tone={tone}>{label}</s-badge>
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
      meta: `${getTimelineCategoryLabel(category)} · ${formatJobStatus(job.status)} · ${diagnostic.technicalReference}`,
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

function getJobTitle(type: string) {
  if (type === "IMPORT_CATALOG") return "Importazione catalogo";
  if (type === "SYNC_INCREMENTAL") return "Aggiornamento catalogo";
  if (type === "UPDATE_EBAY_STOCK") return "Disponibilità eBay";
  if (type === "DETECT_SHOPIFY_CHANGES") return "Modifica Shopify rilevata";
  if (type === "ARCHIVE_INACTIVE_LISTING") return "Archiviazione prodotto";

  return "Attività SyncBay";
}

function getJobDetail(
  job: ActivityJob,
  diagnostic: ReturnType<typeof getSyncJobDiagnostic>,
) {
  const pieces = [
    diagnostic.impact,
    diagnostic.nextAction,
    `Tentativi ${job.attempts}/${job.maxAttempts}`,
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
