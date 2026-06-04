import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { getSyncBayMeta } from "../lib/syncbay-brand";
import { getNextAction } from "../lib/syncbay-ui-state";
import { APP_VERSION, BUILD_DATE } from "../lib/version";
import {
  getDashboardState,
  requestSyncJobRetry,
  resolveSyncConflict,
} from "../services/syncbay.server";
import { authenticate } from "../shopify.server";

type Dashboard = Awaited<ReturnType<typeof getDashboardState>>;
type RecentActivity = {
  detail: string;
  id: string;
  tone: "critical" | "info" | "success" | "warning";
  title: string;
};

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  dateStyle: "short",
  timeStyle: "short",
});

export const meta: MetaFunction = () => getSyncBayMeta("Panoramica");

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

    return Response.json(await requestSyncJobRetry(session, jobId));
  }

  if (intent === "resolveConflict") {
    const conflictId = String(formData.get("conflictId") ?? "");
    const resolution = String(formData.get("resolution") ?? "");

    if (!conflictId) {
      throw new Response("Conflitto SyncBay mancante.", { status: 400 });
    }

    return Response.json(
      await resolveSyncConflict(session, {
        conflictId,
        resolution,
      }),
    );
  }

  throw new Response("Azione Panoramica non supportata.", { status: 400 });
};

export default function Index() {
  const dashboard = useLoaderData<typeof loader>();
  const quantityIssueCount = getQuantityIssueCount(dashboard);
  const settingsMissing = getSettingsMissing(dashboard);
  const importIncomplete = getImportIncomplete(dashboard);
  const nextAction = getNextAction({
    catalogHealthStatus: dashboard.sync.catalogHealth.status,
    ebayOauthEnabled: dashboard.ebay.oauthEnabled,
    ebayOauthReady: dashboard.ebay.oauthReady,
    ebayStatus: dashboard.ebay.status,
    importBlockerCount: dashboard.importPreview.blockers.length,
    importIncomplete,
    openConflictCount: dashboard.conflicts.openCount,
    quantityIssueCount,
    settingsMissing,
  });
  const recentActivity = getRecentActivity(dashboard);

  return (
    <s-page heading="Panoramica">
      <div className="syncbay-page syncbay-stack">
        <s-section heading="Centro operativo">
          <p className="syncbay-section-intro">
            Negozio: {dashboard.shop.domain}. Sync catalogo{" "}
            {dashboard.shop.syncEnabled ? "attivo" : "non attivo"}.
          </p>
          <div
            className={`syncbay-action-panel syncbay-action-panel--${nextAction.tone}`}
          >
            <div>
              <p className="syncbay-action-panel__eyebrow">Prossima azione</p>
              <h2 className="syncbay-action-panel__title">
                {nextAction.title}
              </h2>
              <p className="syncbay-action-panel__body">{nextAction.body}</p>
            </div>
            <div className="syncbay-action-panel__actions">
              <s-button href={nextAction.primaryActionHref} variant="primary">
                {nextAction.primaryActionLabel}
              </s-button>
            </div>
          </div>
        </s-section>

        <s-section heading="Stato rapido">
          <div className="syncbay-metric-grid">
            <MetricCard
              detail="Prodotti Shopify collegati a inserzioni eBay."
              label="Prodotti collegati"
              value={formatNumber(dashboard.imports.mappingCount)}
            />
            <MetricCard
              detail="Richiedono una scelta prima del prossimo allineamento."
              label="Conflitti aperti"
              value={formatNumber(dashboard.conflicts.openCount)}
            />
            <MetricCard
              detail={
                quantityIssueCount > 0
                  ? "Controlli stock emersi dalle ultime attività."
                  : "Nessun controllo stock in evidenza."
              }
              label="Quantità da verificare"
              value={formatNumber(quantityIssueCount)}
            />
            <MetricCard
              detail={getCatalogHealthDetail(dashboard)}
              label="Ultimo aggiornamento"
              value={getCatalogHealthValue(dashboard)}
            />
          </div>
        </s-section>

        <s-section heading="Azioni consigliate">
          <div className="syncbay-inline-actions">
            {dashboard.ebay.oauthReady &&
            dashboard.ebay.oauthEnabled &&
            dashboard.ebay.status !== "CONNECTED" ? (
              <s-button href="/auth/ebay/start">
                {dashboard.ebay.status === "NOT_CONNECTED"
                  ? "Collega eBay"
                  : "Ricollega eBay"}
              </s-button>
            ) : null}
            <s-button href="/app/import-preview">Apri importazione</s-button>
            <s-button href="/app/catalog">Apri catalogo</s-button>
            {dashboard.conflicts.openCount > 0 ? (
              <s-button href="/app/conflicts">Risolvi conflitti</s-button>
            ) : null}
            <s-button href="/app/settings">Apri impostazioni</s-button>
          </div>
        </s-section>

        <s-section heading="Catalogo">
          <ul className="syncbay-status-list">
            <StatusRow
              detail={getEbayDetail(dashboard)}
              label={getEbayStatusLabel(dashboard)}
              tone={dashboard.ebay.status === "CONNECTED" ? "success" : "critical"}
              title={`eBay ${dashboard.ebay.marketplaceId}`}
            />
            <StatusRow
              detail={getSyncHealthDetail(dashboard)}
              label={getCatalogHealthBadge(dashboard)}
              tone={getCatalogHealthTone(dashboard)}
              title="Aggiornamento catalogo"
            />
            <StatusRow
              detail={getImportStatusDetail(dashboard)}
              label={importIncomplete ? "Da completare" : "Pronta"}
              tone={importIncomplete ? "warning" : "success"}
              title="Importazione"
            />
          </ul>
        </s-section>

        <s-section heading="Attività recenti">
          {recentActivity.length > 0 ? (
            <ul className="syncbay-activity-list">
              {recentActivity.map((activity) => (
                <li className="syncbay-activity-row" key={activity.id}>
                  <div>
                    <p className="syncbay-activity-row__title">
                      {activity.title}
                    </p>
                    <p className="syncbay-activity-row__detail">
                      {activity.detail}
                    </p>
                  </div>
                  <span
                    className={`syncbay-badge syncbay-badge--${activity.tone}`}
                  >
                    {getToneLabel(activity.tone)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="syncbay-section-intro">
              Nessuna attività registrata. Quando SyncBay importerà o aggiornerà
              il catalogo, gli eventi appariranno qui.
            </p>
          )}
        </s-section>

        <s-section heading="Dettagli tecnici">
          <details className="syncbay-details">
            <summary>Apri dettagli tecnici</summary>
            <div className="syncbay-details__content">
              <s-unordered-list>
                <s-list-item>
                  Shop collegato: {dashboard.shop.domain}
                </s-list-item>
                <s-list-item>
                  Target sync: {dashboard.shop.syncTargetSeconds} secondi
                </s-list-item>
                <s-list-item>
                  Scope Shopify mancanti:{" "}
                  {dashboard.shopify.missingScopes.length > 0
                    ? dashboard.shopify.missingScopes.join(", ")
                    : "nessuno"}
                </s-list-item>
                <s-list-item>
                  Scope configurazione mancanti:{" "}
                  {dashboard.shopify.missingConfiguredScopes.length > 0
                    ? dashboard.shopify.missingConfiguredScopes.join(", ")
                    : "nessuno"}
                </s-list-item>
                <s-list-item>
                  Queue/Cron:{" "}
                  {dashboard.supabase.queueProviderReady &&
                  dashboard.supabase.schedulerProviderReady
                    ? "predisposto"
                    : "da allineare"}
                </s-list-item>
                <s-list-item>
                  URL pubblico: {dashboard.vercel.publicUrl ?? "non configurato"}
                </s-list-item>
                <s-list-item>Versione app: {APP_VERSION}</s-list-item>
                <s-list-item>Data build: {BUILD_DATE}</s-list-item>
              </s-unordered-list>
            </div>
          </details>
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

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

function getQuantityIssueCount(dashboard: Dashboard) {
  return dashboard.sync.failedJobs.filter(
    (job) => job.type === "UPDATE_EBAY_STOCK",
  ).length;
}

function getSettingsMissing(dashboard: Dashboard) {
  return (
    !dashboard.shop.defaultLocationGid ||
    dashboard.shopify.missingScopes.length > 0 ||
    dashboard.shopify.missingConfiguredScopes.length > 0 ||
    (dashboard.imports.mappingCount > 0 && !dashboard.shop.syncEnabled)
  );
}

function getImportIncomplete(dashboard: Dashboard) {
  return (
    dashboard.imports.mappingCount === 0 ||
    dashboard.importPreview.blockers.length > 0
  );
}

function getRecentActivity(dashboard: Dashboard): RecentActivity[] {
  const jobActivity = dashboard.sync.lastJobs.slice(0, 3).map((job) => ({
    detail: `${formatJobStatus(job.status)}${
      job.errorMessage ? `, ${job.errorMessage}` : ""
    }. ${formatDateTime(job.createdAt)}.`,
    id: `job-${job.id}`,
    title: getJobTitle(job.type),
    tone: getJobTone(job.status),
  }));
  const auditActivity = dashboard.audit.slice(0, 2).map((event) => ({
    detail: formatDateTime(event.createdAt),
    id: `audit-${event.type}-${event.createdAt}`,
    title: event.message,
    tone: "info" as const,
  }));

  return [...jobActivity, ...auditActivity].slice(0, 4);
}

function getEbayStatusLabel(dashboard: Dashboard) {
  if (dashboard.ebay.status === "CONNECTED") return "Collegato";
  if (dashboard.ebay.status === "EXPIRED") return "Scaduto";
  if (dashboard.ebay.status === "REVOKED") return "Revocato";
  if (dashboard.ebay.status === "RECONNECT_REQUIRED") return "Da ricollegare";

  return "Da collegare";
}

function getEbayDetail(dashboard: Dashboard) {
  if (dashboard.ebay.status === "CONNECTED" && dashboard.ebay.connectedAt) {
    return `Collegato dal ${formatDateTime(dashboard.ebay.connectedAt)}.`;
  }

  if (dashboard.ebay.oauthReady && dashboard.ebay.oauthEnabled) {
    return "Puoi collegare o ricollegare l'account eBay da SyncBay.";
  }

  if (dashboard.ebay.missingRequirements.length > 0) {
    return `Mancano ${dashboard.ebay.missingRequirements.length} requisiti di configurazione eBay.`;
  }

  return "Collegamento eBay predisposto, ma non ancora attivo.";
}

function getCatalogHealthBadge(dashboard: Dashboard) {
  const status = dashboard.sync.catalogHealth.status;

  if (status === "disabled") return "Non attivo";
  if (status === "due") return "Da eseguire";
  if (status === "fresh") return "Aggiornato";
  if (status === "overdue") return "In ritardo";
  if (status === "running") return "In corso";

  return "Da controllare";
}

function getCatalogHealthTone(dashboard: Dashboard) {
  const status = dashboard.sync.catalogHealth.status;

  if (status === "fresh") return "success";
  if (status === "overdue") return "warning";
  if (status === "disabled") return "info";

  return "info";
}

function getCatalogHealthValue(dashboard: Dashboard) {
  const latest = dashboard.sync.catalogHealth.latestIncrementalFinishedAt;

  return latest ? formatDateTime(latest) : getCatalogHealthBadge(dashboard);
}

function getCatalogHealthDetail(dashboard: Dashboard) {
  const nextDueAt = dashboard.sync.catalogHealth.nextDueAt;

  if (nextDueAt) return `Prossimo controllo: ${formatDateTime(nextDueAt)}.`;

  return "Nessun aggiornamento incrementale completato.";
}

function getSyncHealthDetail(dashboard: Dashboard) {
  const latest = dashboard.sync.catalogHealth.latestIncrementalFinishedAt;
  const next = dashboard.sync.catalogHealth.nextDueAt;

  if (latest && next) {
    return `Ultimo aggiornamento ${formatDateTime(latest)}, prossimo controllo ${formatDateTime(next)}.`;
  }

  if (latest) return `Ultimo aggiornamento ${formatDateTime(latest)}.`;

  return "Nessun aggiornamento catalogo completato finora.";
}

function getImportStatusDetail(dashboard: Dashboard) {
  if (dashboard.importPreview.blockers.length > 0) {
    return dashboard.importPreview.blockers.join(", ");
  }

  if (dashboard.imports.mappingCount === 0) {
    return "Nessun prodotto collegato: avvia l'importazione quando eBay è pronto.";
  }

  return `${formatNumber(dashboard.imports.mappingCount)} prodotti collegati.`;
}

function getJobTitle(type: string) {
  if (type === "IMPORT_CATALOG") return "Importazione catalogo";
  if (type === "SYNC_INCREMENTAL") return "Aggiornamento catalogo";
  if (type === "UPDATE_EBAY_STOCK") return "Disponibilità aggiornata";
  if (type === "DETECT_SHOPIFY_CHANGES") return "Modifica Shopify rilevata";
  if (type === "ARCHIVE_INACTIVE_LISTING") return "Inserzione non attiva";

  return "Attività SyncBay";
}

function formatJobStatus(status: string) {
  if (status === "PENDING") return "In coda";
  if (status === "RUNNING") return "In corso";
  if (status === "SUCCEEDED") return "Completata";
  if (status === "FAILED") return "Errore";
  if (status === "RETRYING") return "Riproverà automaticamente";
  if (status === "CANCELLED") return "Annullata";

  return status;
}

function getJobTone(status: string): RecentActivity["tone"] {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RETRYING") return "warning";

  return "info";
}

function getToneLabel(tone: RecentActivity["tone"]) {
  if (tone === "success") return "Ok";
  if (tone === "critical") return "Errore";
  if (tone === "warning") return "Attenzione";

  return "Info";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("it-IT").format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "non disponibile";

  return itDateTimeFormatter.format(new Date(value));
}
