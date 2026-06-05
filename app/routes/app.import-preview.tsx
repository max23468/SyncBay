import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  getImportedProductsLabel,
  getImportedProductSingularLabel,
} from "../lib/import-product-status";
import { getEmbeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import {
  getPageWindow,
  normalizePage,
} from "../lib/syncbay-pagination";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import {
  getEbayConnectionAction,
  getEbayConnectionStatusLabel,
  getProductPublicationModeSummaryLabel,
} from "../lib/syncbay-ui-state";
import { authenticate } from "../shopify.server";
import {
  getLocationRenameReadiness,
  renameShopifyLocation,
  type ShopifyLocationRenameStatus,
} from "../services/shopify-location.server";
import {
  type ShopifyDraftImportStatus,
} from "../services/shopify-draft-import.server";
import {
  getImportWizardState,
  recordShopifyLocationRenamed,
  startCatalogImportJobs,
  updateDefaultShopifyLocation,
} from "../services/syncbay.server";

interface ShopifyLocation {
  fulfillsOnlineOrders: boolean;
  id: string;
  isActive: boolean;
  name: string;
}

interface LocationsQueryResponse {
  data?: {
    locations?: {
      nodes?: ShopifyLocation[];
      pageInfo?: {
        endCursor?: string | null;
        hasNextPage: boolean;
      };
    };
  };
  errors?: unknown;
}

type ImportPreviewActionData =
  | {
      count?: number;
      draftStatus: ShopifyDraftImportStatus;
      intent: "createDraftProducts";
      jobCount?: number;
      message?: string;
    }
  | {
      intent: "saveLocation";
      message: string;
      status: "blocked";
    };

export const meta: MetaFunction = () => getSyncBayMeta("Importazione");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [locationResult, wizard] = await Promise.all([
    fetchShopifyLocations(admin),
    getImportWizardState(session),
  ]);
  const selectedLocation = locationResult.locations.find(
    (location) => location.id === wizard.shop.defaultLocationGid,
  );
  const locationRename = getLocationRenameReadiness({
    canWriteLocations: hasSessionScope(session.scope, "write_locations"),
    hasDefaultLocation: Boolean(wizard.shop.defaultLocationGid),
    selectedLocationName: selectedLocation?.name ?? null,
  });

  return {
    canWriteLocations: hasSessionScope(session.scope, "write_locations"),
    locationRename,
    locationError: locationResult.errorMessage,
    locations: locationResult.locations,
    wizard,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const [{ admin, session }, formData] = await Promise.all([
    authenticate.admin(request),
    request.formData(),
  ]);
  const intent = String(formData.get("intent") ?? "saveLocation");

  if (intent === "createDraftProducts") {
    const result = await startCatalogImportJobs(session);

    return Response.json({
      count: result.status === "queued" ? result.plannedListingCount : undefined,
      draftStatus: result.status,
      intent,
      jobCount: result.status === "queued" ? result.batchCount : undefined,
      message:
        result.status === "queued"
          ? formatCatalogImportQueuedMessage(result)
          : result.blockers.join(", "),
    });
  }

  if (intent === "renameLocation") {
    const locationGid = String(formData.get("locationGid") ?? "");
    const locationName = String(formData.get("locationName") ?? "");
    const [wizard, locationResult] = await Promise.all([
      getImportWizardState(session),
      fetchShopifyLocations(admin),
    ]);
    const selectedLocation = locationResult.locations.find(
      (location) => location.id === locationGid,
    );

    if (locationResult.errorMessage) {
      const params = new URLSearchParams({
        locationRename: "blocked",
        message: locationResult.errorMessage,
      });

      throw redirect(`/app/import-preview?${params.toString()}`);
    }

    if (locationGid !== wizard.shop.defaultLocationGid) {
      const params = new URLSearchParams({
        locationRename: "blocked",
        message: "puoi rinominare solo la location Shopify predefinita salvata",
      });

      throw redirect(`/app/import-preview?${params.toString()}`);
    }

    if (!selectedLocation) {
      const params = new URLSearchParams({
        locationRename: "blocked",
        message: "location Shopify predefinita non leggibile o non più attiva",
      });

      throw redirect(`/app/import-preview?${params.toString()}`);
    }

    const result = await renameShopifyLocation({
      admin,
      canWriteLocations: hasSessionScope(session.scope, "write_locations"),
      locationGid,
      name: locationName,
    });

    const params = new URLSearchParams({
      locationRename: result.status,
    });

    if (result.status === "renamed" && result.location) {
      await recordShopifyLocationRenamed(session, {
        locationGid: result.location.id,
        locationName: result.location.name,
        previousLocationName:
          selectedLocation?.name ?? "nome precedente non letto",
      });
      params.set("name", result.location.name);
      params.set("updated", "location-name");
    } else if (result.status === "blocked") {
      params.set("message", result.blockers.join(", "));
    } else if (result.status === "failed" && result.errorMessage) {
      params.set("message", result.errorMessage);
    }

    throw redirect(`/app/import-preview?${params.toString()}`);
  }

  const locationGid = String(formData.get("defaultLocationGid") ?? "");
  const locationResult = await fetchShopifyLocations(admin);

  if (locationResult.errorMessage) {
    return Response.json(
      {
        intent: "saveLocation",
        message: locationResult.errorMessage,
        status: "blocked",
      },
      { status: 409 },
    );
  }

  await updateDefaultShopifyLocation(
    session,
    locationGid,
    locationResult.locations,
  );

  throw redirect("/app/import-preview?updated=location");
};

export default function ImportPreview() {
  const {
    canWriteLocations,
    locationError,
    locationRename,
    locations,
    wizard,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData() as ImportPreviewActionData | undefined;
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const selectedLocation = locations.find(
    (location) => location.id === wizard.shop.defaultLocationGid,
  );
  const isSaving = navigation.state !== "idle";
  const activeIntent = navigation.formData?.get("intent");
  const isRenamingLocation = isSaving && activeIntent === "renameLocation";
  const isSavingLocation = isSaving && activeIntent === "saveLocation";
  const isCreatingDrafts = isSaving && activeIntent === "createDraftProducts";
  const previewModeLabel = getPreviewModeLabel(wizard.previewResult.mode);
  const previewReadLabel = getPreviewReadLabel(wizard.previewSource.source);
  const draftActionData =
    actionData?.intent === "createDraftProducts" ? actionData : null;
  const draftStatus =
    draftActionData?.draftStatus ??
    (searchParams.get("draft") as ShopifyDraftImportStatus | null);
  const locationRenameStatus = searchParams.get(
    "locationRename",
  ) as ShopifyLocationRenameStatus | null;
  const activePreviewFilter = getImportPreviewFilter(
    searchParams.get("previewFilter"),
  );
  const activePreviewPage = normalizePage(searchParams.get("previewPage"));
  const visibleRuntimePhases = wizard.runtimePhases.filter(
    (phase) =>
      !phase.label.toLowerCase().includes("ebay") &&
      !phase.detail.toLowerCase().includes("ebay"),
  );

  return (
    <s-page heading="Importazione">
      <s-badge slot="accessory" tone="info">Anteprima prima</s-badge>
      <s-stack gap="base">
        <PreparationSection
          locationRenameStatus={locationRenameStatus}
          previewSource={wizard.previewSource}
          searchParams={searchParams}
          shopDomain={wizard.shop.domain}
          wizard={wizard}
        />
        <LocationShopifySection
          locationError={locationError}
          locationRename={locationRename}
          locationUiState={{
            canWriteLocations,
            isRenamingLocation,
            isSaving,
            isSavingLocation,
          }}
          locations={locations}
          selectedLocation={selectedLocation}
          wizard={wizard}
        />
        <PreviewStatusSection
          activeFilter={activePreviewFilter}
          activePage={activePreviewPage}
          previewModeLabel={previewModeLabel}
          previewReadLabel={previewReadLabel}
          wizard={wizard}
        />
        <DraftImportSection
          draftCount={draftActionData?.count ?? searchParams.get("count")}
          draftMessage={draftActionData?.message ?? searchParams.get("message")}
          draftStatus={draftStatus}
          isCreatingDrafts={isCreatingDrafts}
          isSaving={isSaving}
          wizard={wizard}
        />
        <AfterImportSection wizard={wizard} />
        <ImportTechnicalDetails
          previewModeLabel={previewModeLabel}
          selectedLocation={selectedLocation}
          visibleRuntimePhases={visibleRuntimePhases}
          wizard={wizard}
        />
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type WizardState = LoaderData["wizard"];
type PreviewSourceState = WizardState["previewSource"];
type LocationRenameState = LoaderData["locationRename"];
type RuntimePhaseState = WizardState["runtimePhases"][number];
type ImportPreviewFilter =
  | "all"
  | "error"
  | "imported"
  | "importing"
  | "ready"
  | "reimport";

const IMPORT_PREVIEW_FILTERS: Array<{
  label: string;
  value: ImportPreviewFilter;
}> = [
  { label: "Tutti", value: "all" },
  { label: "Pronti da importare", value: "ready" },
  { label: "Importazione in corso", value: "importing" },
  { label: "Già importati", value: "imported" },
  { label: "Da reimportare", value: "reimport" },
  { label: "Errore", value: "error" },
];
const IMPORT_PREVIEW_PAGE_SIZE = 10;

function PreparationSection({
  locationRenameStatus,
  previewSource,
  searchParams,
  shopDomain,
  wizard,
}: {
  locationRenameStatus: ShopifyLocationRenameStatus | null;
  previewSource: PreviewSourceState;
  searchParams: URLSearchParams;
  shopDomain: string;
  wizard: WizardState;
}) {
  const ebayAction = getEbayConnectionAction({
    missingRequirementCount: wizard.ebay.missingRequirements.length,
    oauthEnabled: wizard.ebay.oauthEnabled,
    oauthReady: wizard.ebay.oauthReady,
    status: wizard.ebay.status,
  });

  return (
    <s-section heading="Collegamento eBay">
      <s-badge tone="info">Step 1</s-badge>
      <s-text color="subdued">
        Negozio: {shopDomain}. Stato eBay:{" "}
        {getEbayConnectionStatusLabel(wizard.ebay.status)}. SyncBay mostra
        l&apos;anteprima prima di scrivere sul catalogo Shopify.
      </s-text>
      <s-stack direction="inline" gap="small-200">
        {ebayAction.href ? (
          <s-button href={ebayAction.href} variant={ebayAction.variant}>
            {ebayAction.label}
          </s-button>
        ) : null}
      </s-stack>
      {ebayAction.blockerText ? (
        <s-text color="subdued">{ebayAction.blockerText}</s-text>
      ) : null}
      <s-text color="subdued">
        {getPreviewIntro(previewSource.source)}
      </s-text>
      {searchParams.get("updated") === "location" ? (
        <s-paragraph>Location Shopify predefinita salvata.</s-paragraph>
      ) : null}
      {locationRenameStatus === "renamed" ? (
        <s-paragraph>
          Location rinominata: {searchParams.get("name") ?? "nome aggiornato"}.
        </s-paragraph>
      ) : locationRenameStatus === "blocked" ? (
        <s-paragraph>
          Rinomina bloccata:{" "}
          {searchParams.get("message") ?? "permessi incompleti"}.
        </s-paragraph>
      ) : locationRenameStatus === "failed" ? (
        <s-paragraph>
          Rinomina non completata:{" "}
          {searchParams.get("message") ?? "errore Shopify"}.
        </s-paragraph>
      ) : null}
    </s-section>
  );
}

function LocationShopifySection({
  locationError,
  locationRename,
  locationUiState,
  locations,
  selectedLocation,
  wizard,
}: {
  locationError: string | null;
  locationRename: LocationRenameState;
  locationUiState: {
    canWriteLocations: boolean;
    isRenamingLocation: boolean;
    isSaving: boolean;
    isSavingLocation: boolean;
  };
  locations: ShopifyLocation[];
  selectedLocation?: ShopifyLocation;
  wizard: WizardState;
}) {
  return (
    <s-section heading="Preparazione Shopify">
      <s-badge tone="info">Step 2</s-badge>
      <s-text color="subdued">
        Conferma la location e controlla i default di importazione. La
        configurazione completa resta in Impostazioni.
      </s-text>
      {locationError ? (
        <s-paragraph>{locationError}</s-paragraph>
      ) : locations.length > 0 ? (
        <LocationSaveForm
          isSaving={locationUiState.isSaving}
          isSavingLocation={locationUiState.isSavingLocation}
          locations={locations}
          wizard={wizard}
        />
      ) : (
        <s-paragraph>
          Nessuna location Shopify leggibile con gli scope attuali.
        </s-paragraph>
      )}
      {selectedLocation ? (
        <LocationRenameForm
          canWriteLocations={locationUiState.canWriteLocations}
          isRenamingLocation={locationUiState.isRenamingLocation}
          isSaving={locationUiState.isSaving}
          locationRename={locationRename}
          selectedLocation={selectedLocation}
        />
      ) : null}
      <s-stack gap="base">
        <StatusRow
          detail="Default usato per i nuovi prodotti creati dai prossimi import."
          label={wizard.importPreview.defaults.productStatus}
          tone="info"
          title="Stato prodotti"
        />
        <StatusRow
          detail="Policy canali salvata nelle impostazioni SyncBay."
          label={getProductPublicationModeSummaryLabel(
            wizard.productPublications.mode,
            wizard.productPublications.selectedCount,
          )}
          tone="info"
          title="Canali di vendita"
        />
        <StatusRow
          detail={`${wizard.importPreview.defaults.imageImport}; ${wizard.importPreview.defaults.descriptionMode}.`}
          label={`${wizard.previewPlan.limits.maxProducts} prodotti max`}
          tone="info"
          title="Regole MVP"
        />
      </s-stack>
      <s-stack direction="inline" gap="small-200">
        <s-button href="/app/settings">Modifica impostazioni</s-button>
      </s-stack>
    </s-section>
  );
}

function LocationSaveForm({
  isSaving,
  isSavingLocation,
  locations,
  wizard,
}: {
  isSaving: boolean;
  isSavingLocation: boolean;
  locations: ShopifyLocation[];
  wizard: WizardState;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="saveLocation" />
      <s-select
        id="defaultLocationGid"
        label="Location predefinita"
        name="defaultLocationGid"
        value={wizard.shop.defaultLocationGid ?? locations[0]?.id ?? ""}
      >
        {locations.map((location) => (
          <s-option key={location.id} value={location.id}>
            {location.name}
            {location.isActive ? "" : " - non attiva"}
            {location.fulfillsOnlineOrders
              ? ""
              : " - fulfillment online non attivo"}
          </s-option>
        ))}
      </s-select>
      <s-button type="submit" disabled={isSaving}>
        {isSavingLocation ? "Salvataggio..." : "Salva location"}
      </s-button>
    </Form>
  );
}

function LocationRenameForm({
  canWriteLocations,
  isRenamingLocation,
  isSaving,
  locationRename,
  selectedLocation,
}: {
  canWriteLocations: boolean;
  isRenamingLocation: boolean;
  isSaving: boolean;
  locationRename: LocationRenameState;
  selectedLocation: ShopifyLocation;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="renameLocation" />
      <input type="hidden" name="locationGid" value={selectedLocation.id} />
      <s-text-field
        defaultValue={selectedLocation.name}
        disabled={!locationRename.canRename || isSaving}
        id="locationName"
        label="Nome location"
        maxLength={80}
        name="locationName"
        required
      />
      <s-button type="submit" disabled={!locationRename.canRename || isSaving}>
        {isRenamingLocation ? "Rinomina..." : "Rinomina location"}
      </s-button>
      <s-paragraph>{locationRename.nextAction}</s-paragraph>
      {!canWriteLocations ? (
        <s-paragraph>
          Apri di nuovo SyncBay da Shopify Admin per riapprovare il nuovo
          permesso `write_locations`.
        </s-paragraph>
      ) : null}
    </Form>
  );
}

function PreviewStatusSection({
  activeFilter,
  activePage,
  previewModeLabel,
  previewReadLabel,
  wizard,
}: {
  activeFilter: ImportPreviewFilter;
  activePage: number;
  previewModeLabel: string;
  previewReadLabel: string;
  wizard: WizardState;
}) {
  return (
    <s-section heading="Anteprima catalogo">
      <s-badge tone="info">Step 3</s-badge>
      <s-text color="subdued">
        {getPreviewStatusMessage(wizard.previewSource)}
      </s-text>
      <s-text color="subdued">
        Modalità: {previewModeLabel}. {wizard.previewSource.coverageNote}
      </s-text>
      {wizard.importPreview.blockers.length > 0 ? (
        <s-paragraph>
          Blocchi: {wizard.importPreview.blockers.join(", ")}.
        </s-paragraph>
      ) : null}
      <s-grid
        gap="base"
        gridTemplateColumns="repeat(4, minmax(140px, 1fr))"
      >
        <MetricCard
          detail={previewReadLabel}
          label="Letti"
          value={formatNumber(wizard.previewSource.readCount)}
        />
        <MetricCard
          detail="Elementi in anteprima."
          label="Totale"
          value={formatNumber(wizard.previewResult.summary.totalCount)}
        />
        <MetricCard
          detail="Possono entrare nel primo import."
          label="Importabili"
          value={formatNumber(wizard.previewResult.summary.importableCount)}
        />
        <MetricCard
          detail="Da correggere o saltare."
          label="Errori"
          value={formatNumber(wizard.previewResult.summary.errorCount)}
        />
      </s-grid>
      <ImportPreviewFilterNav activeFilter={activeFilter} />
      <PreviewExamplesSection
        activeFilter={activeFilter}
        activePage={activePage}
        wizard={wizard}
      />
    </s-section>
  );
}

function PreviewExamplesSection({
  activeFilter,
  activePage,
  wizard,
}: {
  activeFilter: ImportPreviewFilter;
  activePage: number;
  wizard: WizardState;
}) {
  const filteredItems = filterPreviewItems(
    wizard.previewResult.items,
    activeFilter,
  );
  const pagination = getPageWindow({
    page: activePage,
    pageSize: IMPORT_PREVIEW_PAGE_SIZE,
    totalRows: filteredItems.length,
  });
  const visibleItems = filteredItems.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize,
  );

  return (
    <s-stack gap="base">
      {visibleItems.length > 0 ? (
        <>
          {visibleItems.map((item) => (
            <s-box
              border="base"
              borderColor="base"
              borderRadius="base"
              key={item.itemId}
              padding="base"
            >
              <s-stack
                direction="inline"
                gap="base"
                justifyContent="space-between"
              >
                <s-stack gap="small-200">
                  <s-text type="strong">{item.normalized.title}</s-text>
                  <s-text color="subdued">
                    SKU {item.normalized.sku ?? "mancante"} · immagini{" "}
                    {item.normalized.imageCount} ·{" "}
                    {formatPreviewIssues(item.issues)}
                  </s-text>
                </s-stack>
                <s-badge tone={getPreviewStatusTone(item.status)}>
                  {formatPreviewStatus(item.status)}
                </s-badge>
              </s-stack>
            </s-box>
          ))}
          <ImportPreviewPagination
            activeFilter={activeFilter}
            pagination={pagination}
            totalCatalogRows={wizard.previewResult.summary.totalCount}
          />
        </>
      ) : (
        <s-box border="base" borderColor="base" borderRadius="base" padding="base">
          <s-stack gap="base">
            <s-heading>Nessun elemento in questa vista</s-heading>
            <s-text>
              Prova con il filtro Tutti o completa i prerequisiti di lettura.
            </s-text>
          </s-stack>
        </s-box>
      )}
    </s-stack>
  );
}

function ImportPreviewPagination({
  activeFilter,
  pagination,
  totalCatalogRows,
}: {
  activeFilter: ImportPreviewFilter;
  pagination: ReturnType<typeof getPageWindow>;
  totalCatalogRows: number;
}) {
  if (pagination.totalRows === 0) return null;

  return (
    <s-stack gap="small-200">
      <s-text color="subdued">
        Mostrati {formatNumber(pagination.currentStart)}-
        {formatNumber(pagination.currentEnd)} di{" "}
        {formatNumber(pagination.totalRows)} elementi
        {activeFilter === "all" ? "" : " per questo filtro"}. Anteprima
        totale: {formatNumber(totalCatalogRows)}.
      </s-text>
      <s-stack direction="inline" gap="small-200">
        {pagination.hasPreviousPage && pagination.previousPage ? (
          <s-button
            href={getImportPreviewHref(
              activeFilter,
              pagination.previousPage,
            )}
          >
            Precedente
          </s-button>
        ) : null}
        <s-text color="subdued">
          Pagina {formatNumber(pagination.page)} di{" "}
          {formatNumber(pagination.totalPages)}
        </s-text>
        {pagination.hasNextPage && pagination.nextPage ? (
          <s-button
            href={getImportPreviewHref(activeFilter, pagination.nextPage)}
          >
            Successiva
          </s-button>
        ) : null}
      </s-stack>
    </s-stack>
  );
}

function ImportPreviewFilterNav({
  activeFilter,
}: {
  activeFilter: ImportPreviewFilter;
}) {
  return (
    <s-stack direction="inline" gap="small-200" accessibilityRole="navigation">
      {IMPORT_PREVIEW_FILTERS.map((filter) => (
        <s-clickable-chip
          aria-current={activeFilter === filter.value ? "page" : undefined}
          color={activeFilter === filter.value ? "strong" : "base"}
          href={getImportPreviewHref(filter.value)}
          key={filter.value}
        >
          {filter.label}
        </s-clickable-chip>
      ))}
    </s-stack>
  );
}

function getImportPreviewHref(filter: ImportPreviewFilter, page = 1) {
  const params = new URLSearchParams();

  if (filter !== "all") params.set("previewFilter", filter);
  if (page > 1) params.set("previewPage", String(page));

  const queryString = params.toString();

  return queryString
    ? `/app/import-preview?${queryString}`
    : "/app/import-preview";
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

function DraftImportSection({
  draftCount,
  draftMessage,
  draftStatus,
  isCreatingDrafts,
  isSaving,
  wizard,
}: {
  draftCount?: number | string | null;
  draftMessage?: string | null;
  draftStatus: ShopifyDraftImportStatus | null;
  isCreatingDrafts: boolean;
  isSaving: boolean;
  wizard: WizardState;
}) {
  return (
    <s-section heading="Importazione">
      <s-badge tone="info">Step 4</s-badge>
      <s-text color="subdued">
        Pianifica la creazione o il riuso dei prodotti Shopify dopo aver
        controllato anteprima, location e impostazioni.
      </s-text>
      {draftStatus === "created" ? (
        <s-paragraph>
          Operazione completata:{" "}
          {formatDraftImportCount(
            draftCount,
            wizard.draftImport.importProductStatus,
          )}
          {draftMessage ? ` ${draftMessage}` : null}
        </s-paragraph>
      ) : draftStatus === "queued" ? (
        <s-paragraph>
          Import pianificato:{" "}
          {formatDraftImportCount(
            draftCount,
            wizard.draftImport.importProductStatus,
          )}
          {draftMessage ? ` ${draftMessage}` : null}
        </s-paragraph>
      ) : draftStatus === "blocked" ? (
        <s-paragraph>
          Import Shopify bloccato: {draftMessage ?? "requisiti incompleti"}.
        </s-paragraph>
      ) : draftStatus === "failed" ? (
        <s-paragraph>
          Import Shopify non completato: {draftMessage ?? "errore Shopify"}.
        </s-paragraph>
      ) : null}
      <s-unordered-list>
        <s-list-item>
          Stato: {wizard.draftImport.enabled ? "abilitato" : "disabilitato"}
        </s-list-item>
        <s-list-item>
          Prodotti importabili: {wizard.draftImport.importableCount}
        </s-list-item>
        <s-list-item>
          Limite batch pilota: {wizard.draftImport.draftLimit}
        </s-list-item>
        <s-list-item>
          Stato prodotti creati: {wizard.importPreview.defaults.productStatus}
        </s-list-item>
        <s-list-item>
          Prodotti previsti: {wizard.draftImport.plannedCreateCount}
        </s-list-item>
        <s-list-item>
          Import completo: pianifica batch fino al minore tra listing attivi
          eBay e limite MVP {wizard.previewPlan.limits.maxProducts}
        </s-list-item>
        <s-list-item>{wizard.draftImport.nextAction}</s-list-item>
        {wizard.draftImport.blockers.length > 0 ? (
          <s-list-item>
            Blocchi: {wizard.draftImport.blockers.join(", ")}
          </s-list-item>
        ) : null}
      </s-unordered-list>
      <Form method="post">
        <input type="hidden" name="intent" value="createDraftProducts" />
        <s-button
          type="submit"
          disabled={isSaving || wizard.draftImport.blockers.length > 0}
        >
          {isCreatingDrafts
            ? "Pianificazione..."
            : "Pianifica import catalogo"}
        </s-button>
      </Form>
    </s-section>
  );
}

function AfterImportSection({ wizard }: { wizard: WizardState }) {
  return (
    <s-section heading="Dopo l'import">
      <s-badge tone="info">Step 5</s-badge>
      <s-text color="subdued">
        Dopo la pianificazione puoi controllare i prodotti collegati nel
        Catalogo e completare eventuali canali o default dalle Impostazioni.
      </s-text>
      <s-stack direction="inline" gap="small-200">
        <s-button href="/app/catalog" variant="primary">
          Vai al catalogo
        </s-button>
        <s-button href="/app/settings">Modifica impostazioni</s-button>
      </s-stack>
      <s-stack gap="base">
        <StatusRow
          detail="La tabella mostra mapping, disponibilità, prezzo e stato unico."
          label="Controllo prodotti"
          tone="info"
          title="Catalogo"
        />
        <StatusRow
          detail={`Default prodotti: ${wizard.importPreview.defaults.productStatus}. Canali: ${getProductPublicationModeSummaryLabel(
            wizard.productPublications.mode,
            wizard.productPublications.selectedCount,
          )}.`}
          label="Riepilogo"
          tone="info"
          title="Impostazioni import"
        />
      </s-stack>
    </s-section>
  );
}

function ImportTechnicalDetails({
  previewModeLabel,
  selectedLocation,
  visibleRuntimePhases,
  wizard,
}: {
  previewModeLabel: string;
  selectedLocation?: ShopifyLocation;
  visibleRuntimePhases: RuntimePhaseState[];
  wizard: WizardState;
}) {
  return (
    <s-section heading="Dettagli tecnici">
      <details className="syncbay-details">
        <summary>Apri dettagli importazione</summary>
        <s-stack gap="base">
          <s-unordered-list>
            <s-list-item>Modalità preview: {previewModeLabel}</s-list-item>
            <s-list-item>
              Fonte: {formatPreviewSource(wizard.previewSource.source)}
            </s-list-item>
            <s-list-item>
              Location salvata: {selectedLocation?.name ?? "non confermata"}
            </s-list-item>
            <s-list-item>
              Scritture Shopify: solo dopo conferma esplicita
            </s-list-item>
          </s-unordered-list>
          <s-unordered-list>
            {wizard.validationRules.map((rule) => (
              <s-list-item key={rule.code}>
                {rule.label}: {rule.severity}
              </s-list-item>
            ))}
          </s-unordered-list>
          <s-unordered-list>
            {visibleRuntimePhases.map((phase) => (
              <s-list-item key={phase.label}>
                {phase.label}: {phase.status} - {phase.detail}
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-stack>
      </details>
    </s-section>
  );
}

function formatCatalogImportQueuedMessage(result: {
  batchCount: number;
  createdJobCount: number;
  existingJobCount: number;
  requeuedJobCount: number;
  resumedJobCount: number;
  totalAvailable: number | null;
  truncatedAtMaxProducts: boolean;
}) {
  const totalLabel =
    result.totalAvailable === null
      ? "totale eBay non dichiarato"
      : `totale eBay ${result.totalAvailable}`;
  const capLabel = result.truncatedAtMaxProducts
    ? "limite MVP raggiunto"
    : "store sotto il limite MVP o lettura completata";

  return `${result.batchCount} batch; ${result.createdJobCount} nuovi, ${result.requeuedJobCount} ripianificati, ${result.resumedJobCount} ripresi, ${result.existingJobCount} già presenti; ${totalLabel}; ${capLabel}.`;
}

function formatDraftImportCount(
  count: number | string | null | undefined,
  importProductStatus: WizardState["draftImport"]["importProductStatus"],
) {
  const normalizedCount = count ?? "0";

  if (String(normalizedCount) === "1") {
    return `${normalizedCount} ${getImportedProductSingularLabel(importProductStatus)} gestito dalla preview.`;
  }

  return `${normalizedCount} ${getImportedProductsLabel(importProductStatus)} gestiti dalla preview.`;
}

async function fetchShopifyLocations(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
) {
  const locations: ShopifyLocation[] = [];
  let cursor: string | null = null;

  do {
    const response = await admin.graphql(
      `
    #graphql
    query SyncBayLocations($cursor: String) {
      locations(first: 50, after: $cursor, includeInactive: false) {
        nodes {
          fulfillsOnlineOrders
          id
          isActive
          name
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `,
      { variables: { cursor } },
    );
    const json = (await response.json()) as LocationsQueryResponse;

    if (json.errors) {
      return {
        errorMessage:
          "Location Shopify non leggibili. Verifica che l'app sia reinstallata con lo scope read_locations.",
        locations: [],
      };
    }

    locations.push(...(json.data?.locations?.nodes ?? []));
    cursor = json.data?.locations?.pageInfo?.hasNextPage
      ? (json.data.locations.pageInfo.endCursor ?? null)
      : null;
  } while (cursor);

  return {
    errorMessage: null,
    locations,
  };
}

function hasSessionScope(
  scopes: string | null | undefined,
  requiredScope: string,
) {
  return Boolean(
    scopes
      ?.split(",")
      .map((scope) => scope.trim())
      .includes(requiredScope),
  );
}

function formatPreviewStatus(status: string) {
  if (status === "importable") return "importabile";
  if (status === "skipped") return "saltato";
  if (status === "error") return "da correggere";

  return status;
}

function getImportPreviewFilter(value: string | null): ImportPreviewFilter {
  if (
    value === "error" ||
    value === "imported" ||
    value === "importing" ||
    value === "ready" ||
    value === "reimport"
  ) {
    return value;
  }

  return "all";
}

function filterPreviewItems(
  items: WizardState["previewResult"]["items"],
  filter: ImportPreviewFilter,
) {
  if (filter === "ready") {
    return items.filter((item) => item.status === "importable");
  }
  if (filter === "error") {
    return items.filter((item) => item.status === "error");
  }

  if (filter === "all") return items;

  return [];
}

function getPreviewStatusTone(status: string) {
  if (status === "importable") return "success";
  if (status === "error") return "critical";

  return "warning";
}

function getPreviewIntro(source: string) {
  if (source === "inventory_api" || source === "trading_api") {
    return "La preview live legge eBay in sola lettura e non scrive su Shopify senza conferma esplicita.";
  }

  return "La preview mock usa dati fittizi e resta in sola lettura finché non viene confermata una scrittura esplicita su Shopify.";
}

function getPreviewModeLabel(mode: string) {
  if (mode === "mock") return "dati dimostrativi fittizi";
  if (mode === "live") return "lettura live eBay";
  if (mode === "empty") return "nessun dato";

  return mode;
}

function formatPreviewSource(source: string) {
  if (source === "inventory_api") return "Inventory API eBay";
  if (source === "trading_api") return "Trading API eBay";
  if (source === "mock") return "mock locale";

  return source;
}

function getPreviewReadLabel(source: string) {
  if (source === "inventory_api") return "Elementi Inventory API letti";
  if (source === "trading_api") return "Elementi Trading API letti";
  if (source === "mock") return "Elementi mock letti";

  return "Elementi letti";
}

function getPreviewStatusMessage(source: {
  errorMessage: string | null;
  readCount: number;
  source: string;
}) {
  if (source.errorMessage) {
    return `Preview live non completata: ${source.errorMessage}`;
  }

  if (source.source === "inventory_api") {
    return `Preview live pronta: letti ${source.readCount} elementi Inventory API eBay.`;
  }

  if (source.source === "trading_api") {
    return `Preview live pronta: letti ${source.readCount} elementi Trading API eBay.`;
  }

  return "Preview mock pronta: puoi verificare conteggi, validazioni e messaggi senza collegamenti esterni.";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("it-IT").format(value);
}

function formatPreviewIssues(
  issues: Array<{
    message: string;
    severity: string;
  }>,
) {
  if (issues.length === 0) return "nessun rilievo";

  return issues
    .map((issue) => `${formatIssueSeverity(issue.severity)}: ${issue.message}`)
    .join("; ");
}

function formatIssueSeverity(severity: string) {
  if (severity === "error") return "errore";
  if (severity === "warning") return "warning";
  if (severity === "info") return "nota";

  return severity;
}
