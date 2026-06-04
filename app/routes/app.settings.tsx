import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  getImportProductStatusLabelCapitalized,
  IMPORT_PRODUCT_STATUS_VALUES,
  type ImportProductStatus,
} from "../lib/import-product-status";
import { getEmbeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import { loadShopifyProductPublications } from "../lib/syncbay-product-publication";
import {
  PRODUCT_PUBLICATION_MODES,
  type ProductPublicationMode,
} from "../lib/syncbay-product-publication-settings";
import {
  getEbayConnectionStatusLabel,
  getProductPublicationModeSummaryLabel,
} from "../lib/syncbay-ui-state";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import { authenticate } from "../shopify.server";
import {
  getShopSettingsState,
  updateShopSyncEnabled,
  updateDefaultImportProductStatus,
  updateProductPublicationSettings,
} from "../services/syncbay.server";

type SettingsActionData =
  | {
      defaultProductStatus: ImportProductStatus;
      intent: "saveImportDefaults";
      message: string;
      status: "saved";
    }
  | {
      blockers: string[];
      intent: "saveProductPublications";
      message: string;
      mode: ProductPublicationMode;
      selectedPublicationIds: string[];
      status: "blocked" | "saved";
    }
  | {
      blockers: string[];
      intent: "saveSyncSettings";
      message: string;
      status: "blocked" | "saved";
      syncEnabled: boolean;
    };

export const meta: MetaFunction = () => getSyncBayMeta("Impostazioni");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  return getShopSettingsState(session, admin);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const [{ admin, session }, formData] = await Promise.all([
    authenticate.admin(request),
    request.formData(),
  ]);
  const intent = String(formData.get("intent") ?? "");

  if (intent === "saveSyncSettings") {
    const result = await updateShopSyncEnabled(
      session,
      formData.getAll("syncEnabled").includes("true"),
    );

    return Response.json({
      blockers: result.blockers,
      intent,
      message:
        result.status === "saved"
          ? result.syncEnabled
            ? "Sync catalogo automatico attivato."
            : "Sync catalogo automatico disattivato."
          : `Sync catalogo non attivato: ${result.blockers.join(", ")}.`,
      status: result.status,
      syncEnabled: result.syncEnabled,
    } satisfies SettingsActionData);
  }

  if (intent === "saveImportDefaults") {
    const defaultProductStatus = await updateDefaultImportProductStatus(
      session,
      String(formData.get("defaultProductStatus") ?? ""),
    );

    return Response.json({
      defaultProductStatus,
      intent,
      message: `Default prodotti salvato: ${getImportProductStatusLabelCapitalized(defaultProductStatus)}.`,
      status: "saved",
    } satisfies SettingsActionData);
  }

  if (intent === "saveProductPublications") {
    const mode = String(formData.get("productPublicationMode") ?? "");
    const selectedPublicationIds = formData
      .getAll("productPublicationGids")
      .map((value) => String(value));
    const publications =
      mode === "SELECTED" ? await loadShopifyProductPublications(admin) : [];

    if (!Array.isArray(publications) && "errorMessage" in publications) {
      return Response.json({
        blockers: [publications.errorMessage],
        intent,
        message: `Pubblicazione canali non salvata: ${publications.errorMessage}`,
        mode: "ALL",
        selectedPublicationIds,
        status: "blocked",
      } satisfies SettingsActionData);
    }

    const result = await updateProductPublicationSettings(session, {
      availablePublications: publications,
      mode,
      selectedPublicationIds,
    });

    return Response.json({
      blockers: result.blockers,
      intent,
      message:
        result.status === "saved"
          ? "Pubblicazione canali salvata."
          : `Pubblicazione canali non salvata: ${result.blockers.join(", ")}.`,
      mode: result.mode,
      selectedPublicationIds: result.selectedPublicationIds,
      status: result.status,
    } satisfies SettingsActionData);
  }

  throw new Response("Azione impostazioni non supportata.", { status: 400 });
};

export default function SettingsRoute() {
  const settings = useLoaderData<typeof loader>();
  const actionData = useActionData() as SettingsActionData | undefined;
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";
  const currentStatus =
    actionData?.intent === "saveImportDefaults"
      ? actionData.defaultProductStatus
      : settings.shop.defaultProductStatus;
  const currentSyncEnabled =
    actionData?.intent === "saveSyncSettings"
      ? actionData.syncEnabled
      : settings.shop.syncEnabled;
  const currentPublicationMode =
    actionData?.intent === "saveProductPublications"
      ? actionData.mode
      : settings.productPublications.mode;
  const selectedPublicationIds =
    actionData?.intent === "saveProductPublications"
      ? actionData.selectedPublicationIds
      : settings.productPublications.selectedPublicationIds;

  return (
    <s-page heading="Impostazioni">
      <div className="syncbay-page syncbay-stack syncbay-settings-stack">
      <s-section heading="Sync catalogo">
        <p className="syncbay-section-intro">
          Negozio: {settings.shop.domain}. Il catalogo resta eBay verso
          Shopify; la disponibilità eBay viene aggiornata solo dagli ordini
          Shopify pagati.
        </p>
        <s-unordered-list>
          <s-list-item>
            Stato: {currentSyncEnabled ? "attiva" : "non attiva"}
          </s-list-item>
          <s-list-item>
            Intervallo target: {settings.shop.syncTargetSeconds} secondi
          </s-list-item>
          <s-list-item>
            Prodotti attivi collegati: {settings.sync.activeMappingCount}
          </s-list-item>
        </s-unordered-list>
        {settings.sync.enablementBlockers.length > 0 ? (
          <s-unordered-list>
            {settings.sync.enablementBlockers.map((blocker) => (
              <s-list-item key={blocker}>{blocker}</s-list-item>
            ))}
          </s-unordered-list>
        ) : null}
        {actionData?.intent === "saveSyncSettings" ? (
          <s-paragraph>{actionData.message}</s-paragraph>
        ) : null}
        <Form method="post">
          <input type="hidden" name="intent" value="saveSyncSettings" />
          <input type="hidden" name="syncEnabled" value="false" />
          <label htmlFor="syncEnabled">
            <input
              defaultChecked={currentSyncEnabled}
              id="syncEnabled"
              name="syncEnabled"
              type="checkbox"
              value="true"
            />{" "}
            Sync automatico eBay verso Shopify
          </label>
          <s-button type="submit" disabled={isSaving}>
            {isSaving ? "Salvataggio..." : "Salva sync catalogo"}
          </s-button>
        </Form>
      </s-section>

      <s-section heading="Import prodotti">
        <s-paragraph>
          Il default si applica ai nuovi prodotti creati dai prossimi import.
          Le bozze restano non pubblicate.
        </s-paragraph>
        {actionData?.intent === "saveImportDefaults" ? (
          <s-paragraph>{actionData.message}</s-paragraph>
        ) : null}
        <Form method="post">
          <input type="hidden" name="intent" value="saveImportDefaults" />
          <label htmlFor="defaultProductStatus">Stato prodotti di default</label>
          <select
            defaultValue={currentStatus}
            id="defaultProductStatus"
            name="defaultProductStatus"
          >
            {IMPORT_PRODUCT_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {getImportProductStatusLabelCapitalized(status)}
              </option>
            ))}
          </select>
          <s-button type="submit" disabled={isSaving}>
            {isSaving ? "Salvataggio..." : "Salva stato prodotto default"}
          </s-button>
        </Form>
      </s-section>

      <s-section heading="Canali di vendita">
        <s-paragraph>
          I prodotti attivi creati o riusati seguono questa policy di
          pubblicazione Shopify.
        </s-paragraph>
        <p className="syncbay-section-intro">
          Policy attuale:{" "}
          {getProductPublicationModeSummaryLabel(
            currentPublicationMode,
            selectedPublicationIds.length,
          )}
          .
        </p>
        {settings.productPublications.errorMessage ? (
          <s-paragraph>{settings.productPublications.errorMessage}</s-paragraph>
        ) : null}
        {actionData?.intent === "saveProductPublications" ? (
          <s-paragraph>{actionData.message}</s-paragraph>
        ) : null}
        <Form method="post">
          <input type="hidden" name="intent" value="saveProductPublications" />
          <label htmlFor="productPublicationMode">Pubblicazione prodotti</label>
          <select
            defaultValue={currentPublicationMode}
            id="productPublicationMode"
            name="productPublicationMode"
          >
            {PRODUCT_PUBLICATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {getProductPublicationModeLabel(mode)}
              </option>
            ))}
          </select>
          {settings.productPublications.availablePublications.length > 0 ? (
            <s-unordered-list>
              {settings.productPublications.availablePublications.map(
                (publication) => (
                  <s-list-item key={publication.id}>
                    <label htmlFor={`publication-${publication.id}`}>
                      <input
                        defaultChecked={selectedPublicationIds.includes(
                          publication.id,
                        )}
                        id={`publication-${publication.id}`}
                        name="productPublicationGids"
                        type="checkbox"
                        value={publication.id}
                      />{" "}
                      {publication.title}
                    </label>
                  </s-list-item>
                ),
              )}
            </s-unordered-list>
          ) : (
            <s-paragraph>Nessun canale Shopify disponibile.</s-paragraph>
          )}
          <s-button type="submit" disabled={isSaving}>
            {isSaving ? "Salvataggio..." : "Salva canali"}
          </s-button>
        </Form>
      </s-section>

      <s-section heading="Avanzate">
        <p className="syncbay-section-intro">
          Collegamenti e dettagli tecnici restano qui, separati dalle
          impostazioni operative più frequenti.
        </p>
        <ul className="syncbay-status-list">
          <StatusRow
            detail={`Marketplace ${settings.ebay.marketplaceId}. ${
              settings.ebay.connectedAt
                ? `Collegato il ${formatDateTime(settings.ebay.connectedAt)}.`
                : "Collegamento non completato."
            }`}
            label={getEbayConnectionStatusLabel(settings.ebay.status)}
            tone={
              settings.ebay.status === "CONNECTED" ? "success" : "warning"
            }
            title="Collegamento eBay"
          />
          <StatusRow
            detail={`${settings.shopify.missingScopes.length} scope Shopify mancanti; ${settings.shopify.missingConfiguredScopes.length} scope configurati mancanti.`}
            label={
              settings.shopify.missingScopes.length === 0 &&
              settings.shopify.missingConfiguredScopes.length === 0
                ? "Completi"
                : "Da controllare"
            }
            tone={
              settings.shopify.missingScopes.length === 0 &&
              settings.shopify.missingConfiguredScopes.length === 0
                ? "success"
                : "warning"
            }
            title="Permessi Shopify"
          />
          <StatusRow
            detail={settings.shopify.webhookTopics.join(", ")}
            label={`${settings.shopify.webhookTopics.length} topic`}
            tone="info"
            title="Webhook"
          />
        </ul>
        <div className="syncbay-inline-actions">
          {settings.ebay.oauthEnabled && settings.ebay.oauthReady ? (
            <s-button href="/auth/ebay/start">
              {settings.ebay.status === "CONNECTED"
                ? "Ricollega eBay"
                : "Collega eBay"}
            </s-button>
          ) : null}
          <s-button href="/app/activity">Apri attività</s-button>
          <s-button href="/app/import-preview">Apri importazione</s-button>
          <s-button href="/app">Torna alla Panoramica</s-button>
        </div>
        <details className="syncbay-details">
          <summary>Apri dettagli tecnici</summary>
          <div className="syncbay-details__content">
            <s-unordered-list>
              <s-list-item>
                Scope Shopify attivi:{" "}
                {settings.shopify.scopes.length > 0
                  ? settings.shopify.scopes.join(", ")
                  : "nessuno"}
              </s-list-item>
              <s-list-item>
                Scope richiesti dalla configurazione:{" "}
                {settings.shopify.configuredScopes.length > 0
                  ? settings.shopify.configuredScopes.join(", ")
                  : "nessuno"}
              </s-list-item>
            </s-unordered-list>
          </div>
        </details>
      </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

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

function formatDateTime(value: string) {
  return itDateTimeFormatter.format(new Date(value));
}

function getProductPublicationModeLabel(mode: ProductPublicationMode) {
  if (mode === "NONE") return "Non pubblicare automaticamente";
  if (mode === "SELECTED") return "Solo canali selezionati";

  return "Tutti i canali disponibili";
}
