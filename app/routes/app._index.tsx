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
    ? "Pronta per OAuth"
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
          <s-list-item>Shopify: collegato</s-list-item>
          <s-list-item>
            eBay {dashboard.ebay.marketplaceId}: {dashboard.ebay.status}
          </s-list-item>
          <s-list-item>OAuth eBay: {ebayStatus}</s-list-item>
          <s-list-item>Sync catalogo: {syncStatus}</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Prossime azioni">
        <s-unordered-list>
          {dashboard.ebay.missingRequirements.length > 0 ? (
            <s-list-item>
              Completa: {dashboard.ebay.missingRequirements.join(", ")}.
            </s-list-item>
          ) : (
            <s-list-item>Avvia connessione OAuth eBay.</s-list-item>
          )}
          <s-list-item>Conferma location Shopify predefinita.</s-list-item>
          <s-list-item>Prepara preview import, senza sync automatico.</s-list-item>
        </s-unordered-list>
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
          <s-list-item>Queue/Cron: placeholder Supabase</s-list-item>
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
