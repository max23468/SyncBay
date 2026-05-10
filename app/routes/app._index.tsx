import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { APP_VERSION } from "../lib/version";
import { getDashboardState } from "../services/syncbay.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return getDashboardState(session);
};

export default function Index() {
  const dashboard = useLoaderData<typeof loader>();
  const ebayStatus = dashboard.ebay.oauthReady
    ? dashboard.ebay.oauthStatus
    : "In attesa configurazione";
  const syncStatus = dashboard.shop.syncEnabled ? "Attiva" : "Non attiva";
  const lastJobs = dashboard.sync.lastJobs;

  return (
    <s-page heading="SyncBay">
      <s-section heading="Stato connessioni">
        <s-paragraph>
          Shop collegato: {dashboard.shop.domain}. Fase: custom app pilota.
        </s-paragraph>
        <s-unordered-list>
          {dashboard.readiness.map((item) => (
            <s-list-item key={item.label}>
              {item.label}: {item.status} - {item.detail}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading="Shopify">
        <s-unordered-list>
          <s-list-item>Installazione: collegata</s-list-item>
          <s-list-item>
            Scope richiesti: {dashboard.shopify.configuredScopes.join(", ")}
          </s-list-item>
          <s-list-item>
            Scope mancanti:{" "}
            {dashboard.shopify.missingScopes.length > 0
              ? dashboard.shopify.missingScopes.join(", ")
              : "nessuno"}
          </s-list-item>
          <s-list-item>
            Scope mancanti nella configurazione app:{" "}
            {dashboard.shopify.missingConfiguredScopes.length > 0
              ? dashboard.shopify.missingConfiguredScopes.join(", ")
              : "nessuno"}
          </s-list-item>
          <s-list-item>
            Webhook pilota: {dashboard.shopify.webhookTopics.join(", ")}
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="eBay e privacy">
        <s-unordered-list>
          <s-list-item>
            eBay {dashboard.ebay.marketplaceId}: {dashboard.ebay.status}
          </s-list-item>
          <s-list-item>OAuth eBay: {ebayStatus}</s-list-item>
          <s-list-item>
            Account deletion endpoint:{" "}
            {dashboard.ebay.accountDeletion.endpointConfigured
              ? "predisposto"
              : "da configurare"}
          </s-list-item>
          <s-list-item>
            Notifiche account deletion:{" "}
            {dashboard.ebay.accountDeletion.notificationsEnabled
              ? "abilitate"
              : "non abilitate"}
          </s-list-item>
          <s-list-item>Sync catalogo: {syncStatus}</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Onboarding e preview">
        <s-unordered-list>
          {dashboard.ebay.missingRequirements.length > 0 ? (
            <s-list-item>
              Completa: {dashboard.ebay.missingRequirements.join(", ")}.
            </s-list-item>
          ) : !dashboard.ebay.oauthEnabled ? (
            <s-list-item>
              Attendi il keyset eBay dedicato prima di testare OAuth.
            </s-list-item>
          ) : (
            <s-list-item>Avvia connessione OAuth eBay.</s-list-item>
          )}
          <s-list-item>Conferma location Shopify predefinita.</s-list-item>
          <s-list-item>
            Default prodotti: {dashboard.onboarding.defaults.productStatus}
          </s-list-item>
          <s-list-item>
            Default descrizioni: {dashboard.onboarding.defaults.descriptionMode}
          </s-list-item>
          <s-list-item>
            Preview import:{" "}
            {dashboard.importPreview.blockers.length > 0
              ? dashboard.importPreview.blockers.join(", ")
              : "pronta"}
          </s-list-item>
        </s-unordered-list>
        <s-button href="/app/import-preview">Apri preview import</s-button>
      </s-section>

      <s-section heading="Attività recenti">
        {lastJobs.length > 0 ? (
          <s-unordered-list>
            {lastJobs.map((job) => (
              <s-list-item key={`${job.type}-${job.createdAt}`}>
                {job.type}: {job.status}
              </s-list-item>
            ))}
          </s-unordered-list>
        ) : (
          <s-paragraph>Nessun job SyncBay registrato.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Audit">
        {dashboard.audit.length > 0 ? (
          <s-unordered-list>
            {dashboard.audit.map((event) => (
              <s-list-item key={`${event.type}-${event.createdAt}`}>
                {event.message}
              </s-list-item>
            ))}
          </s-unordered-list>
        ) : (
          <s-paragraph>Nessun evento operativo registrato.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Base tecnica">
        <s-unordered-list>
          <s-list-item>Distribuzione Shopify: custom app pilota</s-list-item>
          <s-list-item>
            Target sync: {dashboard.shop.syncTargetSeconds} secondi
          </s-list-item>
          <s-list-item>Storage sessioni e dominio: Prisma</s-list-item>
          <s-list-item>
            Queue/Cron:{" "}
            {dashboard.supabase.queueProviderReady &&
            dashboard.supabase.schedulerProviderReady
              ? "Supabase predisposto"
              : "da allineare"}
          </s-list-item>
          <s-list-item>
            Storage staging: {dashboard.supabase.storageBucket}
          </s-list-item>
          <s-list-item>
            URL pubblico: {dashboard.vercel.publicUrl ?? "non configurato"}
          </s-list-item>
          <s-list-item>Osservabilità: Vercel Analytics e Speed Insights</s-list-item>
          <s-list-item>Versione app: {APP_VERSION}</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Scope Shopify">
        <s-unordered-list>
          {dashboard.shopify.scopes.length > 0 ? (
            dashboard.shopify.scopes.map((scope) => (
              <s-list-item key={scope}>{scope}</s-list-item>
            ))
          ) : (
            <s-list-item>Scope non ancora letti dalla sessione.</s-list-item>
          )}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
