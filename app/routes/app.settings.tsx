import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { ActionRow, MetricTile, SettingCard } from "../components/SyncBayUi";
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
import {
  getSyncTargetLabel,
  SYNC_TARGET_OPTIONS,
} from "../lib/syncbay-sync-interval";
import { authenticate } from "../shopify.server";
import {
  disconnectEbayConnection,
  getShopSettingsState,
  updateShopSyncEnabled,
  updateDefaultImportProductStatus,
  updateProductPublicationSettings,
  updateSyncTargetSeconds,
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
    }
  | {
      intent: "saveSyncTarget";
      message: string;
      status: "blocked" | "saved";
      syncTargetSeconds: number;
    }
  | {
      intent: "disconnectEbay";
      message: string;
      status: "disconnected" | "not_connected";
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

  if (intent === "saveSyncTarget") {
    const result = await updateSyncTargetSeconds(
      session,
      String(formData.get("syncTargetSeconds") ?? ""),
    );

    return Response.json({
      intent,
      message: result.message,
      status: result.status,
      syncTargetSeconds: result.syncTargetSeconds,
    } satisfies SettingsActionData);
  }

  if (intent === "disconnectEbay") {
    const result = await disconnectEbayConnection(session);

    return Response.json({
      intent,
      message: result.message,
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
  const currentSyncTarget =
    actionData?.intent === "saveSyncTarget"
      ? actionData.syncTargetSeconds
      : settings.shop.syncTargetSeconds;

  return (
    <s-page heading="Impostazioni">
      <s-badge slot="accessory" tone="info">Controllo operativo</s-badge>
      <s-stack gap="large">
        <SettingCard
          description="Quanto lasciare lavorare SyncBay in autonomia."
          icon="refresh"
          statusLabel={currentSyncEnabled ? "Attivo" : "Non attivo"}
          statusTone={currentSyncEnabled ? "success" : "neutral"}
          title="Sync catalogo"
        >
          <s-text color="subdued">
            Negozio: {settings.shop.domain}. Il catalogo resta eBay verso
            Shopify; la disponibilità eBay viene aggiornata solo dagli ordini
            Shopify pagati.
          </s-text>
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
          >
            <MetricTile
              detail="Ultimo aggiornamento incrementale completato."
              icon="check-circle"
              label="Ultimo aggiornamento"
              tone={settings.sync.lastIncrementalFinishedAt ? "success" : "neutral"}
              value={
                settings.sync.lastIncrementalFinishedAt
                  ? formatDateTime(settings.sync.lastIncrementalFinishedAt)
                  : "Mai"
              }
            />
            <MetricTile
              detail="Prodotti eBay attivi collegati a Shopify."
              icon="link"
              label="Prodotti collegati"
              tone="neutral"
              value={formatNumber(settings.sync.activeMappingCount)}
            />
          </s-grid>
          {settings.sync.enablementBlockers.length > 0 ? (
            <s-box
              border="base"
              borderColor="base"
              borderRadius="base"
              padding="base"
            >
              <s-stack gap="small-200">
                <s-badge tone="warning">Sync non attivabile</s-badge>
                <s-text>
                  Per attivare il sync automatico mancano questi prerequisiti:
                </s-text>
                <s-unordered-list>
                  {settings.sync.enablementBlockers.map((blocker) => (
                    <s-list-item key={blocker}>{blocker}</s-list-item>
                  ))}
                </s-unordered-list>
              </s-stack>
            </s-box>
          ) : null}
          {actionData?.intent === "saveSyncTarget" ? (
            <s-paragraph>{actionData.message}</s-paragraph>
          ) : null}
          <Form method="post">
            <input type="hidden" name="intent" value="saveSyncTarget" />
            <s-select
              id="syncTargetSeconds"
              label="Intervallo target di aggiornamento"
              name="syncTargetSeconds"
              value={String(currentSyncTarget)}
            >
              {SYNC_TARGET_OPTIONS.map((option) => (
                <s-option key={option.value} value={String(option.value)}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
            <s-text color="subdued">
              Tempo entro cui SyncBay punta ad allineare il catalogo (massimo 5
              minuti). Attuale: {getSyncTargetLabel(currentSyncTarget)}.
            </s-text>
            <s-button type="submit" disabled={isSaving}>
              {isSaving ? "Salvataggio..." : "Salva intervallo"}
            </s-button>
          </Form>
          {actionData?.intent === "saveSyncSettings" ? (
            <s-paragraph>{actionData.message}</s-paragraph>
          ) : null}
          {currentSyncEnabled ? (
            <details className="syncbay-details">
              <summary>Disattiva sync automatico</summary>
              <s-stack gap="small-200">
                <s-text>
                  Disattivando il sync, SyncBay smette di allineare il catalogo
                  da eBay a Shopify finché non lo riattivi. La disponibilità
                  eBay dagli ordini Shopify resta gestita a parte.
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="saveSyncSettings" />
                  <input type="hidden" name="syncEnabled" value="false" />
                  <s-button type="submit" disabled={isSaving}>
                    Conferma disattivazione
                  </s-button>
                </Form>
              </s-stack>
            </details>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="saveSyncSettings" />
              <input type="hidden" name="syncEnabled" value="false" />
              <s-switch
                defaultChecked={currentSyncEnabled}
                id="syncEnabled"
                label="Sync automatico eBay verso Shopify"
                name="syncEnabled"
                value="true"
              />
              <s-button type="submit" disabled={isSaving}>
                {isSaving ? "Salvataggio..." : "Salva sync catalogo"}
              </s-button>
            </Form>
          )}
        </SettingCard>

        <SettingCard
          description="Stato dei nuovi prodotti creati dai prossimi import."
          icon="import"
          statusLabel={getImportProductStatusLabelCapitalized(currentStatus)}
          statusTone="info"
          title="Import prodotti"
        >
          <s-paragraph>
            Il default si applica ai nuovi prodotti creati dai prossimi import.
            Le bozze restano non pubblicate.
          </s-paragraph>
          {actionData?.intent === "saveImportDefaults" ? (
            <s-paragraph>{actionData.message}</s-paragraph>
          ) : null}
          <Form method="post">
            <input type="hidden" name="intent" value="saveImportDefaults" />
            <s-select
              id="defaultProductStatus"
              label="Stato prodotti di default"
              name="defaultProductStatus"
              value={currentStatus}
            >
              {IMPORT_PRODUCT_STATUS_VALUES.map((status) => (
                <s-option key={status} value={status}>
                  {getImportProductStatusLabelCapitalized(status)}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit" disabled={isSaving}>
              {isSaving ? "Salvataggio..." : "Salva stato prodotto default"}
            </s-button>
          </Form>
        </SettingCard>

        <SettingCard
          description="Dove vengono pubblicati i prodotti su Shopify."
          icon="store-online"
          statusLabel={getProductPublicationModeSummaryLabel(
            currentPublicationMode,
            selectedPublicationIds.length,
          )}
          statusTone="info"
          title="Canali di vendita"
        >
          <s-paragraph>
            I prodotti attivi creati o riusati seguono questa policy di
            pubblicazione Shopify.
          </s-paragraph>
          {settings.productPublications.errorMessage ? (
            <s-paragraph>
              {settings.productPublications.errorMessage}
            </s-paragraph>
          ) : null}
          {actionData?.intent === "saveProductPublications" ? (
            <s-paragraph>{actionData.message}</s-paragraph>
          ) : null}
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="saveProductPublications"
            />
            <s-select
              id="productPublicationMode"
              label="Pubblicazione prodotti"
              name="productPublicationMode"
              value={currentPublicationMode}
            >
              {PRODUCT_PUBLICATION_MODES.map((mode) => (
                <s-option key={mode} value={mode}>
                  {getProductPublicationModeLabel(mode)}
                </s-option>
              ))}
            </s-select>
            <s-text color="subdued">
              Le caselle qui sotto valgono solo con la policy «Solo canali
              selezionati».
            </s-text>
            {settings.productPublications.availablePublications.length > 0 ? (
              <s-stack gap="small-200">
                {settings.productPublications.availablePublications.map(
                  (publication) => (
                    <s-checkbox
                      defaultChecked={selectedPublicationIds.includes(
                        publication.id,
                      )}
                      id={`publication-${publication.id}`}
                      key={publication.id}
                      label={publication.title}
                      name="productPublicationGids"
                      value={publication.id}
                    />
                  ),
                )}
              </s-stack>
            ) : (
              <s-paragraph>Nessun canale Shopify disponibile.</s-paragraph>
            )}
            <s-button type="submit" disabled={isSaving}>
              {isSaving ? "Salvataggio..." : "Salva canali"}
            </s-button>
          </Form>
        </SettingCard>

        <SettingCard
          description="Collegamenti e dettagli tecnici, separati dalle impostazioni più frequenti."
          icon="settings"
          statusLabel={
            settings.ebay.status === "CONNECTED"
              ? "Collegato"
              : getEbayConnectionStatusLabel(settings.ebay.status)
          }
          statusTone={
            settings.ebay.status === "CONNECTED" ? "success" : "warning"
          }
          title="Avanzate"
        >
          <s-stack gap="base">
            <StatusRow
              detail={`Marketplace ${settings.ebay.marketplaceId}. ${
                settings.ebay.connectedAt
                  ? `Collegato il ${formatDateTime(settings.ebay.connectedAt)}.`
                  : "Collegamento non completato."
              }`}
              label={getEbayConnectionStatusLabel(settings.ebay.status)}
              tone={settings.ebay.status === "CONNECTED" ? "success" : "warning"}
              title="Collegamento eBay"
            />
            <StatusRow
              detail={`${settings.shopify.missingScopes.length} permessi Shopify mancanti; ${settings.shopify.missingConfiguredScopes.length} da riapprovare.`}
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
          </s-stack>
          <div className="syncbay-action-list">
            {settings.ebay.oauthEnabled && settings.ebay.oauthReady ? (
              <ActionRow
                description="Apri il collegamento eBay."
                href="/auth/ebay/start"
                icon="connect"
                label={
                  settings.ebay.status === "CONNECTED"
                    ? "Ricollega eBay"
                    : "Collega eBay"
                }
                tone="info"
              />
            ) : null}
            <ActionRow
              description="Cronologia di import, aggiornamenti ed errori."
              href="/app/activity"
              icon="clock"
              label="Apri attività"
            />
            <ActionRow
              description="Porta nuovi prodotti eBay su Shopify."
              href="/app/import-preview"
              icon="import"
              label="Apri importazione"
            />
            <ActionRow
              description="Stato operativo e prossime azioni."
              href="/app"
              icon="store-online"
              label="Torna alla Panoramica"
            />
          </div>
          {actionData?.intent === "disconnectEbay" ? (
            <s-paragraph>{actionData.message}</s-paragraph>
          ) : null}
          {settings.ebay.status === "CONNECTED" ? (
            <details className="syncbay-details">
              <summary>Scollega account eBay</summary>
              <s-stack gap="small-200">
                <s-text>
                  Scollegando eBay, SyncBay cancella i token salvati e ferma il
                  sync automatico. Il catalogo già importato resta su Shopify e
                  potrai ricollegare eBay quando vuoi.
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="disconnectEbay" />
                  <s-button type="submit" disabled={isSaving}>
                    Conferma scollegamento
                  </s-button>
                </Form>
              </s-stack>
            </details>
          ) : null}
          <details className="syncbay-details">
            <summary>Apri dettagli tecnici</summary>
            <s-stack gap="base">
              <s-unordered-list>
                <s-list-item>
                  Webhook attivi ({settings.shopify.webhookTopics.length}):{" "}
                  {settings.shopify.webhookTopics.length > 0
                    ? settings.shopify.webhookTopics.join(", ")
                    : "nessuno"}
                </s-list-item>
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
            </s-stack>
          </details>
        </SettingCard>
      </s-stack>
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

function formatDateTime(value: string) {
  return itDateTimeFormatter.format(new Date(value));
}

const itNumberFormatter = new Intl.NumberFormat("it-IT");

function formatNumber(value: number) {
  return itNumberFormatter.format(value);
}

function getProductPublicationModeLabel(mode: ProductPublicationMode) {
  if (mode === "NONE") return "Non pubblicare automaticamente";
  if (mode === "SELECTED") return "Solo canali selezionati";

  return "Tutti i canali disponibili";
}
