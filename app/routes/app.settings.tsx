import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  ActionRow,
  MetricTile,
  SettingCard,
  type SyncBayIcon,
} from "../components/SyncBayUi";
import { useActionToast } from "../components/SyncBayLive";
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
  PRICE_ROUNDING_MODES,
  type PriceRoundingMode,
  type SyncBayPricingRule,
} from "../lib/syncbay-pricing-rules";
import {
  DESCRIPTION_RULE_MODES,
  getDescriptionRuleDetail,
  getDescriptionRuleSummary,
  type SyncBayDescriptionRule,
} from "../lib/syncbay-description-rules";
import {
  getEbayConnectionStatusLabel,
  getProductPublicationModeSummaryLabel,
} from "../lib/syncbay-ui-state";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import {
  getSyncTargetLabel,
  SYNC_TARGET_OPTIONS,
} from "../lib/syncbay-sync-interval";
import { APP_VERSION, BUILD_DATE } from "../lib/version";
import { authenticate } from "../shopify.server";
import {
  disconnectEbayConnection,
  getShopSettingsState,
  updateShopSyncEnabled,
  updateDefaultImportProductStatus,
  updateDescriptionRuleSettings,
  updatePricingRuleSettings,
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
      descriptionRule: SyncBayDescriptionRule;
      intent: "saveDescriptionRule";
      message: string;
      status: "blocked" | "saved";
    }
  | {
      intent: "savePricingRule";
      message: string;
      pricingRule: SyncBayPricingRule;
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

type SettingsState = Awaited<ReturnType<typeof getShopSettingsState>>;

const DEFAULT_SETTINGS_PRICING_RULE: SyncBayPricingRule = {
  discountPercent: 0,
  roundingMode: "CENTS",
};

const DEFAULT_SETTINGS_DESCRIPTION_RULE: SyncBayDescriptionRule = {
  mode: "CLEAN_HTML",
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

  if (intent === "savePricingRule") {
    const result = await updatePricingRuleSettings(session, {
      discountPercent: String(formData.get("discountPercent") ?? ""),
      roundingMode: String(formData.get("roundingMode") ?? ""),
    });

    return Response.json({
      intent,
      message: result.message,
      pricingRule: result.pricingRule,
      status: result.status,
    } satisfies SettingsActionData);
  }

  if (intent === "saveDescriptionRule") {
    const result = await updateDescriptionRuleSettings(session, {
      mode: String(formData.get("descriptionRuleMode") ?? ""),
    });

    return Response.json({
      descriptionRule: result.descriptionRule,
      intent,
      message: result.message,
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
  const currentPricingRule =
    actionData?.intent === "savePricingRule"
      ? actionData.pricingRule
      : (settings.pricingRule ?? DEFAULT_SETTINGS_PRICING_RULE);
  const currentDescriptionRule =
    actionData?.intent === "saveDescriptionRule"
      ? actionData.descriptionRule
      : (settings.descriptionRule ?? DEFAULT_SETTINGS_DESCRIPTION_RULE);
  const configReady =
    settings.ebay.status === "CONNECTED" &&
    settings.shopify.missingScopes.length === 0 &&
    settings.shopify.missingConfiguredScopes.length === 0;

  useActionToast(
    { data: actionData, state: navigation.state },
    (data) => ({ isError: data.status === "blocked", message: data.message }),
  );

  return (
    <s-page heading="Impostazioni" inlineSize="large">
      <s-badge slot="accessory" tone={configReady ? "success" : "warning"}>
        {configReady ? "Configurato" : "Da configurare"}
      </s-badge>
      <s-stack gap="large">
        <SyncCatalogSettingsCard
          currentSyncEnabled={currentSyncEnabled}
          currentSyncTarget={currentSyncTarget}
          isSaving={isSaving}
          settings={settings}
        />

        <s-grid
          gap="large"
          gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
        >
          <ImportProductSettingsCard
            currentStatus={currentStatus}
            isSaving={isSaving}
          />
          <ProductPublicationSettingsCard
            currentPublicationMode={currentPublicationMode}
            isSaving={isSaving}
            selectedPublicationIds={selectedPublicationIds}
            settings={settings}
          />
          <PricingRuleSettingsCard
            currentPricingRule={currentPricingRule}
            isSaving={isSaving}
          />
          <DescriptionRuleSettingsCard
            currentDescriptionRule={currentDescriptionRule}
            isSaving={isSaving}
          />
        </s-grid>

        <AdvancedSettingsCard
          isSaving={isSaving}
          settings={settings}
        />
      </s-stack>
    </s-page>
  );
}

function DescriptionRuleSettingsCard({
  currentDescriptionRule,
  isSaving,
}: {
  currentDescriptionRule: SyncBayDescriptionRule;
  isSaving: boolean;
}) {
  return (
    <SettingCard
      description="Come SyncBay prepara le descrizioni eBay per Shopify."
      icon="product"
      statusLabel={getDescriptionRuleSummary(currentDescriptionRule.mode)}
      statusTone="info"
      title="Regola descrizione"
    >
      <s-paragraph>{getDescriptionRuleDetail(currentDescriptionRule.mode)}</s-paragraph>
      <Form method="post">
        <input type="hidden" name="intent" value="saveDescriptionRule" />
        <s-select
          id="descriptionRuleMode"
          label="Modalità descrizione"
          name="descriptionRuleMode"
          value={currentDescriptionRule.mode}
        >
          {DESCRIPTION_RULE_MODES.map((mode) => (
            <s-option key={mode} value={mode}>
              {getDescriptionRuleSummary(mode)}
            </s-option>
          ))}
        </s-select>
        <s-text color="subdued">
          La scelta vale per i prossimi import e per le anteprime di pulizia. I
          prodotti già importati non vengono riscritti automaticamente.
        </s-text>
        <s-button type="submit" disabled={isSaving}>
          {isSaving ? "Salvataggio..." : "Salva regola descrizione"}
        </s-button>
      </Form>
    </SettingCard>
  );
}

function SyncCatalogSettingsCard({
  currentSyncEnabled,
  currentSyncTarget,
  isSaving,
  settings,
}: {
  currentSyncEnabled: boolean;
  currentSyncTarget: number;
  isSaving: boolean;
  settings: SettingsState;
}) {
  return (
    <SettingCard
      description="Quanto lasciare lavorare SyncBay in autonomia."
      icon="refresh"
      statusLabel={currentSyncEnabled ? "Attivo" : "Non attivo"}
      statusTone={currentSyncEnabled ? "success" : "neutral"}
      title="Sync catalogo"
    >
      <s-text color="subdued">
        Negozio: {settings.shop.domain}. Il catalogo resta eBay verso Shopify;
        la disponibilità eBay viene aggiornata solo dagli ordini Shopify pagati.
      </s-text>
      <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))">
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
        <s-box border="base" borderColor="base" borderRadius="base" padding="base">
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
      {currentSyncEnabled ? (
        <details className="syncbay-details">
          <summary>Disattiva sync automatico</summary>
          <s-stack gap="small-200">
            <s-text>
              Disattivando il sync, SyncBay smette di allineare il catalogo da
              eBay a Shopify finché non lo riattivi. La disponibilità eBay dagli
              ordini Shopify resta gestita a parte.
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
  );
}

function ImportProductSettingsCard({
  currentStatus,
  isSaving,
}: {
  currentStatus: ImportProductStatus;
  isSaving: boolean;
}) {
  return (
    <SettingCard
      description="Stato dei nuovi prodotti creati dai prossimi import."
      icon="import"
      statusLabel={getImportProductStatusLabelCapitalized(currentStatus)}
      statusTone="info"
      title="Import prodotti"
    >
      <s-paragraph>
        Il default si applica ai nuovi prodotti creati dai prossimi import. Le
        bozze restano non pubblicate.
      </s-paragraph>
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
  );
}

function ProductPublicationSettingsCard({
  currentPublicationMode,
  isSaving,
  selectedPublicationIds,
  settings,
}: {
  currentPublicationMode: ProductPublicationMode;
  isSaving: boolean;
  selectedPublicationIds: string[];
  settings: SettingsState;
}) {
  return (
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
        <s-paragraph>{settings.productPublications.errorMessage}</s-paragraph>
      ) : null}
      <Form method="post">
        <input type="hidden" name="intent" value="saveProductPublications" />
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
                  defaultChecked={selectedPublicationIds.includes(publication.id)}
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
  );
}

function PricingRuleSettingsCard({
  currentPricingRule,
  isSaving,
}: {
  currentPricingRule: SyncBayPricingRule;
  isSaving: boolean;
}) {
  return (
    <SettingCard
      description="Prezzo Shopify calcolato dal prezzo eBay."
      icon="product"
      statusLabel={getPricingRuleSummaryLabel(currentPricingRule)}
      statusTone={currentPricingRule.discountPercent > 0 ? "success" : "neutral"}
      title="Regola prezzo"
    >
      <s-paragraph>
        Lo sconto si applica a tutti i prodotti importati o riallineati. Il
        prezzo eBay resta come compare-at price Shopify quando lo sconto è
        maggiore di zero.
      </s-paragraph>
      <Form method="post">
        <input type="hidden" name="intent" value="savePricingRule" />
        <s-text-field
          defaultValue={String(currentPricingRule.discountPercent)}
          id="discountPercent"
          label="Sconto sul prezzo eBay"
          name="discountPercent"
          required
        />
        <s-text color="subdued">
          Inserisci un numero intero da 0 a 90. Con 0 SyncBay mantiene il prezzo
          eBay senza prezzo barrato.
        </s-text>
        <s-select
          id="roundingMode"
          label="Arrotondamento prezzo Shopify"
          name="roundingMode"
          value={currentPricingRule.roundingMode}
        >
          {PRICE_ROUNDING_MODES.map((roundingMode) => (
            <s-option key={roundingMode} value={roundingMode}>
              {getPriceRoundingModeLabel(roundingMode)}
            </s-option>
          ))}
        </s-select>
        <s-button type="submit" disabled={isSaving}>
          {isSaving ? "Salvataggio..." : "Salva regola prezzo"}
        </s-button>
      </Form>
    </SettingCard>
  );
}

function AdvancedSettingsCard({
  isSaving,
  settings,
}: {
  isSaving: boolean;
  settings: SettingsState;
}) {
  return (
    <SettingCard
      description="Stato dei collegamenti e dei permessi, con le azioni per sistemarli."
      icon="settings"
      statusLabel={
        settings.ebay.status === "CONNECTED"
          ? "Collegato"
          : getEbayConnectionStatusLabel(settings.ebay.status)
      }
      statusTone={settings.ebay.status === "CONNECTED" ? "success" : "warning"}
      title="Collegamenti e diagnostica"
    >
      <s-stack gap="base">
        <StatusRow
          detail={
            settings.ebay.status === "CONNECTED"
              ? `Marketplace ${settings.ebay.marketplaceId}${
                  settings.ebay.connectedAt
                    ? `, collegato il ${formatDateTime(settings.ebay.connectedAt)}`
                    : ""
                }.`
              : "eBay non è collegato: import e allineamento restano fermi finché non lo colleghi."
          }
          icon="link"
          label={getEbayConnectionStatusLabel(settings.ebay.status)}
          tone={settings.ebay.status === "CONNECTED" ? "success" : "warning"}
          title="Collegamento eBay"
        />
        <StatusRow
          detail={getShopifyScopesDetail(settings)}
          icon="settings"
          label={
            settings.shopify.missingScopes.length === 0 &&
            settings.shopify.missingConfiguredScopes.length === 0
              ? "Completi"
              : "Da sistemare"
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
      {settings.ebay.oauthEnabled &&
      settings.ebay.oauthReady &&
      settings.ebay.status !== "CONNECTED" ? (
        <div className="syncbay-action-list">
          <ActionRow
            description="Riattiva import, aggiornamenti e disponibilità."
            href="/auth/ebay/start"
            icon="connect"
            label="Collega eBay"
            tone="critical"
          />
        </div>
      ) : null}
      {settings.ebay.status === "CONNECTED" ? (
        <details className="syncbay-details">
          <summary>Scollega account eBay</summary>
          <s-stack gap="small-200">
            <s-text>
              Scollegando eBay, SyncBay cancella i token salvati e ferma il sync
              automatico. Il catalogo già importato resta su Shopify e potrai
              ricollegare eBay quando vuoi.
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
            <s-list-item>
              Versione SyncBay: {APP_VERSION} ({BUILD_DATE})
            </s-list-item>
          </s-unordered-list>
        </s-stack>
      </details>
    </SettingCard>
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

function getShopifyScopesDetail(settings: SettingsState) {
  const missing = settings.shopify.missingScopes.length;
  const config = settings.shopify.missingConfiguredScopes.length;

  if (missing === 0 && config === 0) {
    return "Tutti i permessi necessari sono concessi.";
  }

  const parts: string[] = [];
  if (config > 0) {
    parts.push(`${config} da aggiungere alla configurazione dell'app`);
  }
  if (missing > 0) {
    parts.push(`${missing} da concedere reinstallando l'app`);
  }

  return `Permessi da sistemare: ${parts.join("; ")}.`;
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

function getPriceRoundingModeLabel(mode: PriceRoundingMode) {
  if (mode === "WHOLE_EURO") return "Arrotonda all'euro";

  return "Due decimali";
}

function getPricingRuleSummaryLabel(rule: SyncBayPricingRule) {
  if (rule.discountPercent === 0) return "Prezzo eBay";

  return `-${rule.discountPercent}%`;
}
