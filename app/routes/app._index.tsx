import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  ActionRow,
  MetricTile,
  RiskLens,
  Sparkline,
  StatusHero,
  Step,
  type StepStatus,
  SyncPulse,
  TimelineEvent,
  type SyncBayIcon,
  type SyncBayTone,
} from "../components/SyncBayUi";
import { LiveSync } from "../components/SyncBayLive";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import { getEmbeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import { getNextAction, type NextActionKind } from "../lib/syncbay-ui-state";
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

const BLOCKER_KINDS: NextActionKind[] = [
  "ebay_connection",
  "settings_missing",
  "import_incomplete",
];

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
  const firstRun = dashboard.imports.mappingCount === 0;
  const onboardingSteps = getOnboardingSteps(dashboard);
  const riskCount = getRiskCount(dashboard);
  const settingsMissing = getSettingsMissing(dashboard);
  const importIncomplete = getImportIncomplete(dashboard);
  const working = isSyncWorking(dashboard);
  const nextAction = getNextAction({
    catalogHealthStatus: dashboard.sync.catalogHealth.status,
    ebayOauthEnabled: dashboard.ebay.oauthEnabled,
    ebayOauthReady: dashboard.ebay.oauthReady,
    ebayStatus: dashboard.ebay.status,
    importBlockerCount: dashboard.importPreview.blockers.length,
    importIncomplete,
    openConflictCount: dashboard.conflicts.openCount,
    quantityIssueCount: riskCount,
    settingsMissing,
  });
  const showBlocker = BLOCKER_KINDS.includes(nextAction.kind);
  const recentActivity = getRecentActivity(dashboard);
  const contextualActions = getContextualActions(dashboard, importIncomplete);
  const minutes = Math.max(1, Math.round(dashboard.shop.syncTargetSeconds / 60));
  const reliability = dashboard.metrics.reliability;
  const newMappings = dashboard.metrics.trends.newMappings24h;
  const newConflicts = dashboard.metrics.trends.newConflicts24h;

  return (
    <s-page heading="Panoramica" inlineSize="large">
      <s-badge slot="accessory" tone={getBadgeTone(firstRun, working)}>
        {getBadgeLabel(firstRun, working)}
      </s-badge>
      <s-stack gap="large">
        <LiveSync working={working} />
        {firstRun ? <FirstRunOnboarding steps={onboardingSteps} /> : null}
        {firstRun ? null : (
        <>
        {showBlocker ? (
          <StatusHero
            actionHref={nextAction.primaryActionHref}
            actionLabel={nextAction.primaryActionLabel}
            body={nextAction.body}
            icon={getHeroIcon(nextAction.kind)}
            title={nextAction.title}
            tone={nextAction.tone}
          />
        ) : null}

        <RiskLens
          body={getRiskBody(riskCount)}
          count={riskCount}
          href="/app/catalog"
          title={getRiskTitle(riskCount)}
        />

        <s-box
          border="base"
          borderColor="base"
          borderRadius="base"
          padding="base"
        >
          <s-stack gap="base">
            <s-stack
              direction="inline"
              gap="base"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-heading>Da eBay a Shopify</s-heading>
              <s-text color="subdued">{getPulseStatus(dashboard, working)}</s-text>
            </s-stack>
            <SyncPulse
              appliedLabel={getAppliedLabel(dashboard, working)}
              marketplaceLabel={`eBay ${formatMarketplaceLabel(
                dashboard.ebay.marketplaceId,
              )}`}
              readLabel={getReadLabel(dashboard)}
              working={working}
            />
          </s-stack>
        </s-box>

        <div>
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
          >
            <MetricTile
              detail="Seguiti e allineati a eBay."
              icon="link"
              label="Prodotti collegati"
              tone="info"
              trend={
                newMappings > 0
                  ? {
                      label: `${formatNumber(newMappings)} ${
                        newMappings === 1 ? "nuovo" : "nuovi"
                      } da ieri`,
                      tone: "up",
                    }
                  : undefined
              }
              value={formatNumber(dashboard.imports.mappingCount)}
            />
            <MetricTile
              detail={
                dashboard.conflicts.openCount > 0
                  ? "Scegli quale valore mantenere."
                  : "Niente da rivedere."
              }
              icon="alert-triangle"
              label="Conflitti aperti"
              tone={dashboard.conflicts.openCount > 0 ? "warning" : "neutral"}
              trend={
                newConflicts > 0
                  ? {
                      label: `${formatNumber(newConflicts)} ${
                        newConflicts === 1 ? "nuovo" : "nuovi"
                      } da ieri`,
                      tone: "watch",
                    }
                  : undefined
              }
              value={formatNumber(dashboard.conflicts.openCount)}
            />
            <MetricTile
              detail={
                dashboard.sync.catalogHealth.nextDueAt
                  ? `Prossimo ${formatDateTime(
                      dashboard.sync.catalogHealth.nextDueAt,
                    )}.`
                  : "In attesa del primo controllo."
              }
              icon="clock"
              label="Controllo automatico"
              tone="neutral"
              value={`ogni ${minutes} min`}
            />
          </s-grid>
          <div className="syncbay-reliability">
            <s-text color="subdued">
              {reliability.totalJobs > 0
                ? `Ultimi ${reliability.windowDays} giorni · ${formatNumber(
                    reliability.totalJobs,
                  )} sincronizzazioni · ${reliability.successRate}% riuscite.`
                : "Nessuna sincronizzazione negli ultimi 7 giorni."}
            </s-text>
            {reliability.totalJobs > 0 ? (
              <Sparkline
                ariaLabel="Andamento sincronizzazioni ultimi 7 giorni"
                values={reliability.daily}
              />
            ) : null}
          </div>
        </div>

        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))"
        >
          <s-section heading="Cosa fare adesso">
            <div className="syncbay-action-list">
              {contextualActions.map((action) => (
                <ActionRow
                  description={action.description}
                  href={action.href}
                  icon={action.icon}
                  key={action.label}
                  label={action.label}
                  tone={action.tone}
                />
              ))}
            </div>
          </s-section>

          <s-section heading="Attività recente">
            {recentActivity.length > 0 ? (
              <ul className="syncbay-timeline">
                {recentActivity.map((activity, index) => (
                  <TimelineEvent
                    icon={getActivityIcon(activity.tone)}
                    isLast={index === recentActivity.length - 1}
                    key={activity.id}
                    tone={activity.tone}
                  >
                    <s-stack gap="small-200">
                      <s-heading>{activity.title}</s-heading>
                      <s-text color="subdued">{activity.detail}</s-text>
                    </s-stack>
                  </TimelineEvent>
                ))}
              </ul>
            ) : (
              <s-text color="subdued">
                Ancora nessuna attività. Appena SyncBay importa o aggiorna il
                catalogo, gli eventi compaiono qui.
              </s-text>
            )}
          </s-section>
        </s-grid>
        </>
        )}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

type OnboardingSteps = {
  ebay: StepStatus;
  importCatalog: StepStatus;
  sync: StepStatus;
};

function getOnboardingSteps(dashboard: Dashboard): OnboardingSteps {
  const ebayConnected = dashboard.ebay.status === "CONNECTED";
  const imported = dashboard.imports.mappingCount > 0;
  const syncOn = dashboard.shop.syncEnabled;

  return {
    ebay: ebayConnected ? "completed" : "active",
    importCatalog: !ebayConnected
      ? "pending"
      : imported
        ? "completed"
        : "active",
    sync: !imported ? "pending" : syncOn ? "completed" : "active",
  };
}

function stepStatusLabel(status: StepStatus) {
  if (status === "completed") return "Fatto";
  if (status === "active") return "Da fare ora";

  return "In attesa";
}

function getBadgeTone(firstRun: boolean, working: boolean): SyncBayTone {
  if (firstRun) return "info";

  return working ? "info" : "success";
}

function getBadgeLabel(firstRun: boolean, working: boolean) {
  if (firstRun) return "Configurazione iniziale";

  return working ? "Sincronizzazione in corso" : "Tutto sincronizzato";
}

function FirstRunOnboarding({ steps }: { steps: OnboardingSteps }) {
  return (
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack gap="base">
        <s-stack gap="small-200">
          <s-heading>Benvenuto in SyncBay</s-heading>
          <s-text color="subdued">
            Tre passi e il tuo catalogo eBay è su Shopify, pronto a vendere. Ti
            guidiamo uno alla volta.
          </s-text>
        </s-stack>
        <ul className="syncbay-stepper">
          <Step
            index={1}
            status={steps.ebay}
            statusLabel={stepStatusLabel(steps.ebay)}
            title="Collega il tuo account eBay"
          >
            <s-text color="subdued">
              SyncBay legge le tue inserzioni da eBay.it. eBay resta la tua
              sorgente: non viene modificato.
            </s-text>
            {steps.ebay === "active" ? (
              <div>
                <s-button href="/auth/ebay/start" variant="primary">
                  Collega eBay
                </s-button>
              </div>
            ) : null}
          </Step>
          <Step
            index={2}
            status={steps.importCatalog}
            statusLabel={stepStatusLabel(steps.importCatalog)}
            title="Importa il catalogo"
          >
            <s-text color="subdued">
              Rivedi le inserzioni trovate su eBay e portale in Shopify, con
              un&apos;anteprima prima di confermare.
            </s-text>
            {steps.importCatalog === "active" ? (
              <div>
                <s-button href="/app/import-preview" variant="primary">
                  Vai all&apos;importazione
                </s-button>
              </div>
            ) : null}
          </Step>
          <Step
            index={3}
            isLast
            status={steps.sync}
            statusLabel={stepStatusLabel(steps.sync)}
            title="Attiva la sincronizzazione"
          >
            <s-text color="subdued">
              Da qui SyncBay tiene Shopify allineato a eBay e protegge le
              disponibilità, entro 5 minuti.
            </s-text>
            {steps.sync === "active" ? (
              <div>
                <s-button href="/app/settings" variant="primary">
                  Apri le impostazioni
                </s-button>
              </div>
            ) : null}
          </Step>
        </ul>
        <s-text color="subdued">
          Completati i tre passi, qui compare la panoramica operativa: stato del
          sync, prodotti a rischio e attività.
        </s-text>
      </s-stack>
    </s-box>
  );
}

function isSyncWorking(dashboard: Dashboard) {
  return (
    dashboard.sync.catalogHealth.status === "running" ||
    dashboard.sync.catalogHealth.activeIncrementalJobCount > 0 ||
    dashboard.sync.pendingJobs > 0
  );
}

function getRiskCount(dashboard: Dashboard) {
  // Un aggiornamento di disponibilità verso eBay non andato a buon fine = il
  // prodotto può restare in vendita su Shopify senza scorta reale. Contiamo i
  // job di stock falliti e quelli ancora in riprova.
  const failedStock = dashboard.sync.failedJobs.filter(
    (job) => job.type === "UPDATE_EBAY_STOCK",
  ).length;
  const retryingStock = dashboard.sync.lastJobs.filter(
    (job) => job.type === "UPDATE_EBAY_STOCK" && job.status === "RETRYING",
  ).length;

  return failedStock + retryingStock;
}

function getRiskTitle(count: number) {
  if (count === 0) return "Le disponibilità sono protette";

  return count === 1
    ? "1 prodotto potrebbe essere venduto senza disponibilità"
    : `${formatNumber(count)} prodotti potrebbero essere venduti senza disponibilità`;
}

function getRiskBody(count: number) {
  if (count === 0) {
    return "Nessun prodotto rischia di essere venduto senza scorta. SyncBay tiene Shopify allineato a eBay.";
  }

  return "Disponibili su Shopify, ma l'aggiornamento della disponibilità verso eBay non è andato a buon fine. SyncBay resta in modalità prudente finché non controlli.";
}

function getPulseStatus(dashboard: Dashboard, working: boolean) {
  if (working) return "Allineamento in corso";

  const latest = dashboard.sync.catalogHealth.latestIncrementalFinishedAt;

  return latest
    ? `Aggiornato ${formatDateTime(latest)}`
    : "In attesa del primo allineamento";
}

function getReadLabel(dashboard: Dashboard) {
  const requested = dashboard.sync.lastRunCounts.requested;

  if (requested !== null) {
    return requested === 1
      ? "1 inserzione letta"
      : `${formatNumber(requested)} inserzioni lette`;
  }

  return `${formatNumber(dashboard.imports.mappingCount)} prodotti seguiti`;
}

function getAppliedLabel(dashboard: Dashboard, working: boolean) {
  const pending = dashboard.sync.pendingJobs;

  if (working && pending > 0) {
    return pending === 1
      ? "1 aggiornamento in coda"
      : `${formatNumber(pending)} aggiornamenti in coda`;
  }

  const synced = dashboard.sync.lastRunCounts.synced;

  if (synced !== null) {
    return synced === 1 ? "1 aggiornata" : `${formatNumber(synced)} aggiornate`;
  }

  return working ? "allineamento in corso" : "tutto allineato";
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

function getHeroIcon(kind: NextActionKind): SyncBayIcon {
  if (kind === "ebay_connection") return "link";
  if (kind === "quantity_check") return "inventory";
  if (kind === "open_conflicts") return "alert-triangle";
  if (kind === "catalog_overdue") return "clock";
  if (kind === "import_incomplete") return "import";
  if (kind === "settings_missing") return "alert-circle";

  return "check-circle";
}

function getActivityIcon(tone: RecentActivity["tone"]): SyncBayIcon {
  if (tone === "success") return "check-circle";
  if (tone === "critical") return "alert-circle";
  if (tone === "warning") return "alert-triangle";

  return "refresh";
}

function formatMarketplaceLabel(marketplaceId: string) {
  return marketplaceId.replace(/^EBAY_/, "");
}

type ContextualAction = {
  description: string;
  href: string;
  icon: SyncBayIcon;
  label: string;
  tone: SyncBayTone;
};

function getContextualActions(
  dashboard: Dashboard,
  importIncomplete: boolean,
): ContextualAction[] {
  const actions: ContextualAction[] = [];

  if (
    dashboard.ebay.oauthReady &&
    dashboard.ebay.oauthEnabled &&
    dashboard.ebay.status !== "CONNECTED"
  ) {
    actions.push({
      description: "Riattiva import, aggiornamenti e disponibilità.",
      href: "/auth/ebay/start",
      icon: "link",
      label:
        dashboard.ebay.status === "NOT_CONNECTED"
          ? "Collega eBay"
          : "Ricollega eBay",
      tone: "critical",
    });
  }

  if (dashboard.conflicts.openCount > 0) {
    actions.push({
      description: "Scegli quale valore mantenere tra eBay e Shopify.",
      href: "/app/conflicts",
      icon: "alert-triangle",
      label:
        dashboard.conflicts.openCount === 1
          ? "Risolvi 1 conflitto"
          : `Risolvi ${formatNumber(dashboard.conflicts.openCount)} conflitti`,
      tone: "warning",
    });
  }

  actions.push({
    description: "Porta in Shopify le inserzioni trovate su eBay.",
    href: "/app/import-preview",
    icon: "import",
    label: importIncomplete ? "Completa l'importazione" : "Importa nuove inserzioni",
    tone: "neutral",
  });

  if (actions.length < 2) {
    actions.push({
      description: "Sfoglia i prodotti collegati e il loro stato.",
      href: "/app/catalog",
      icon: "product",
      label: "Apri il catalogo",
      tone: "neutral",
    });
  }

  return actions;
}

function getJobTitle(type: string) {
  if (type === "IMPORT_CATALOG") return "Importazione catalogo";
  if (type === "SYNC_INCREMENTAL") return "Allineamento catalogo";
  if (type === "UPDATE_EBAY_STOCK") return "Disponibilità aggiornata su eBay";
  if (type === "DETECT_SHOPIFY_CHANGES") return "Modifica rilevata su Shopify";
  if (type === "ARCHIVE_INACTIVE_LISTING") return "Prodotto segnato come esaurito";

  return "Attività SyncBay";
}

function formatJobStatus(status: string) {
  if (status === "PENDING") return "In coda";
  if (status === "RUNNING") return "In corso";
  if (status === "SUCCEEDED") return "Completata";
  if (status === "FAILED") return "Errore";
  if (status === "RETRYING") return "Riprova automatica in corso";
  if (status === "CANCELLED") return "Annullata";

  return status;
}

function getJobTone(status: string): RecentActivity["tone"] {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RETRYING") return "warning";

  return "info";
}

const itNumberFormatter = new Intl.NumberFormat("it-IT");

function formatNumber(value: number) {
  return itNumberFormatter.format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "non disponibile";

  return itDateTimeFormatter.format(new Date(value));
}
