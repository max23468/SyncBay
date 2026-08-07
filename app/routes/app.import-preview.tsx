import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import {
  AfterImportSection as ExtractedAfterImportSection,
  DraftImportSection as ExtractedDraftImportSection,
  ImportTechnicalDetails as ExtractedImportTechnicalDetails,
} from "../components/ImportExecutionSections";
import { Step, type StepStatus } from "../components/SyncBayUi";
import { useActionToast } from "../hooks/use-action-toast";
import { getSyncBayMeta } from "../lib/syncbay-brand";
import { embeddedNoStoreHeaders } from "../lib/syncbay-cache-headers";
import { parseExistingCatalogLegacyTagsToRemove } from "../lib/syncbay-existing-catalog-field-policy";
import {
  getCatalogModeDraftImportBlocker,
  normalizeImportCatalogMode,
} from "../lib/syncbay-import-catalog-mode";
import { normalizeImportPreviewLoadMode } from "../lib/syncbay-import-preview-mode";
import { isLiveImportPreviewStepComplete } from "../lib/syncbay-import-preview-stepper";
import {
  IMPORT_PREVIEW_PAGE_SIZE,
  normalizeImportPreviewWindowFilter,
  windowImportPreviewResult,
} from "../lib/syncbay-import-preview-window";
import { computeSequentialStepStatuses } from "../lib/syncbay-import-step-status";
import {
  createSyncBayLoaderPerformanceTrace,
  logSyncBayLoaderPerformance,
} from "../lib/syncbay-loader-performance";
import { normalizePage } from "../lib/syncbay-pagination";
import { parseFormDataWithLimit } from "../lib/syncbay-request-body";
import { startExistingCatalogTakeoverJobs } from "../services/existing-catalog-takeover.server";
import { type ShopifyDraftImportStatus } from "../services/shopify-draft-import.server";
import {
  getLocationRenameReadiness,
  renameShopifyLocation,
  type ShopifyLocation,
  type ShopifyLocationRenameStatus,
} from "../services/shopify-location.server";
import { getImportWizardState, startCatalogImportJobs } from "../services/syncbay-import.server";
import {
  recordShopifyLocationRenamed,
  updateDefaultShopifyLocation,
} from "../services/syncbay-product-updates.server";
import { authenticate } from "../shopify.server";

import {
  LocationShopifySection,
  PreparationSection,
  PreviewStatusSection,
} from "../components/ImportPreviewSections";

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
      count?: number;
      intent: "applyExistingCatalogTakeover";
      jobCount?: number;
      message?: string;
      status: "blocked" | "queued";
    }
  | {
      intent: "saveLocation";
      message: string;
      status: "blocked";
    };

export const meta: MetaFunction = () => getSyncBayMeta("Importazione");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const trace = createSyncBayLoaderPerformanceTrace();
  const url = new URL(request.url);
  const previewLoadMode = normalizeImportPreviewLoadMode(url.searchParams.get("preview"));
  const catalogMode = normalizeImportCatalogMode(url.searchParams.get("catalogMode"));
  const activePreviewFilter = normalizeImportPreviewWindowFilter(
    url.searchParams.get("previewFilter"),
  );
  const activePreviewPage = normalizePage(url.searchParams.get("previewPage"));
  const { admin, session } = await trace.measure("auth.admin", () => authenticate.admin(request));
  const [locationResult, wizard] = await Promise.all([
    trace.measure("import.shopify.locations", () => fetchShopifyLocations(admin)),
    trace.measure("import.wizard", () =>
      getImportWizardState(session, admin, trace, {
        catalogMode,
        previewLoadMode,
      }),
    ),
  ]);
  const selectedLocation = locationResult.locations.find(
    (location) => location.id === wizard.shop.defaultLocationGid,
  );
  const locationRename = getLocationRenameReadiness({
    canWriteLocations: hasSessionScope(session.scope, "write_locations"),
    hasDefaultLocation: Boolean(wizard.shop.defaultLocationGid),
    selectedLocationName: selectedLocation?.name ?? null,
  });
  const windowedWizard = {
    ...wizard,
    previewResult: windowImportPreviewResult(wizard.previewResult, {
      filter: activePreviewFilter,
      page: activePreviewPage,
      pageSize: IMPORT_PREVIEW_PAGE_SIZE,
    }),
  };

  const state = {
    canWriteLocations: hasSessionScope(session.scope, "write_locations"),
    locationRename,
    locationError: locationResult.errorMessage,
    locations: locationResult.locations,
    wizard: windowedWizard,
  };

  logSyncBayLoaderPerformance({
    request,
    details: {
      draftImportEnabled: wizard.draftImport.enabled,
      importableCount: windowedWizard.draftImport.importableCount,
      catalogMode,
      locations: locationResult.locations.length,
      plannedCreateCount: windowedWizard.draftImport.plannedCreateCount,
      previewLoadMode,
      previewSource: windowedWizard.previewSource.source,
    },
    payload: state,
    route: "import",
    trace,
  });

  return state;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Il body va letto solo dopo l'autenticazione: parallelizzare drenerebbe lo
  // stream di richieste non autenticate.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const formData = await parseFormDataWithLimit(request);
  const intent = String(formData.get("intent") ?? "saveLocation");

  if (intent === "createDraftProducts") {
    const catalogMode = normalizeImportCatalogMode(formData.get("catalogMode"));
    const catalogModeBlocker = getCatalogModeDraftImportBlocker(catalogMode);

    if (catalogModeBlocker) {
      return Response.json(
        {
          draftStatus: "blocked",
          intent,
          message: catalogModeBlocker,
        },
        { status: 409 },
      );
    }

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

  if (intent === "applyExistingCatalogTakeover") {
    const result = await startExistingCatalogTakeoverJobs({
      admin,
      confirmation: String(formData.get("confirmation") ?? "").trim(),
      legacyTagsToRemove: parseExistingCatalogLegacyTagsToRemove(
        formData.get("legacyTagsToRemove"),
      ),
      session,
    });

    return Response.json(
      {
        count: result.status === "queued" ? result.plannedListingCount : undefined,
        intent,
        jobCount: result.status === "queued" ? result.batchCount : undefined,
        message:
          result.status === "queued"
            ? formatCatalogImportQueuedMessage(result)
            : result.blockers.join(", "),
        status: result.status,
      },
      { status: result.status === "queued" ? 200 : 409 },
    );
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
        previousLocationName: selectedLocation?.name ?? "nome precedente non letto",
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

  await updateDefaultShopifyLocation(session, locationGid, locationResult.locations);

  throw redirect("/app/import-preview?updated=location");
};

export default function ImportPreview() {
  const { canWriteLocations, locationError, locationRename, locations, wizard } =
    useLoaderData<typeof loader>();
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
  const isApplyingTakeover = isSaving && activeIntent === "applyExistingCatalogTakeover";
  const previewModeLabel = getPreviewModeLabel(wizard.previewResult.mode);
  const previewReadLabel = getPreviewReadLabel(wizard.previewSource.source);
  const draftActionData = actionData?.intent === "createDraftProducts" ? actionData : null;
  const takeoverActionData =
    actionData?.intent === "applyExistingCatalogTakeover" ? actionData : null;
  const draftStatus =
    draftActionData?.draftStatus ?? (searchParams.get("draft") as ShopifyDraftImportStatus | null);
  const takeoverQueued = takeoverActionData?.status === "queued";

  useActionToast(
    {
      data: draftActionData ?? takeoverActionData ?? undefined,
      state: navigation.state,
    },
    (data) => ({
      isError:
        data.intent === "applyExistingCatalogTakeover"
          ? data.status !== "queued"
          : data.draftStatus !== "queued",
      message: data.message ?? "",
    }),
  );
  const locationRenameStatus = searchParams.get(
    "locationRename",
  ) as ShopifyLocationRenameStatus | null;
  const activePreviewFilter = normalizeImportPreviewWindowFilter(searchParams.get("previewFilter"));
  const activePreviewPage = normalizePage(searchParams.get("previewPage"));
  const visibleRuntimePhases = wizard.runtimePhases.filter(
    (phase) =>
      !phase.label.toLowerCase().includes("ebay") && !phase.detail.toLowerCase().includes("ebay"),
  );

  const stepDone = [
    wizard.ebay.status === "CONNECTED",
    Boolean(wizard.shop.defaultLocationGid) && !locationError,
    isLiveImportPreviewStepComplete({
      importableCount: wizard.previewResult.summary.importableCount,
      previewErrorMessage: wizard.previewSource.errorMessage,
      previewSource: wizard.previewSource.source,
    }),
    takeoverQueued || draftStatus === "created" || draftStatus === "queued",
    // "Dopo l'import" non si completa mai: diventa attivo quando l'import è
    // avviato e resta l'ultimo passo del percorso.
    false,
  ];
  const stepStatuses = computeSequentialStepStatuses(stepDone);

  return (
    <s-page heading="Importazione" inlineSize="large">
      <s-badge slot="accessory" tone="info">
        Anteprima prima
      </s-badge>
      <ol className="syncbay-stepper">
        <Step
          index={1}
          status={stepStatuses[0]}
          statusLabel={getStepStatusLabel(stepStatuses[0], "Da collegare")}
          title="Collegamento eBay"
        >
          <PreparationSection
            locationRenameStatus={locationRenameStatus}
            previewSource={wizard.previewSource}
            searchParams={searchParams}
            shopDomain={wizard.shop.domain}
            wizard={wizard}
          />
        </Step>
        <Step
          index={2}
          status={stepStatuses[1]}
          statusLabel={getStepStatusLabel(stepStatuses[1], "Da preparare")}
          title="Preparazione Shopify"
        >
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
        </Step>
        <Step
          index={3}
          status={stepStatuses[2]}
          statusLabel={getStepStatusLabel(stepStatuses[2], "Da controllare")}
          title="Anteprima catalogo"
        >
          <PreviewStatusSection
            activeFilter={activePreviewFilter}
            activePage={activePreviewPage}
            previewModeLabel={previewModeLabel}
            previewReadLabel={previewReadLabel}
            searchParams={searchParams}
            wizard={wizard}
          />
        </Step>
        <Step
          index={4}
          status={stepStatuses[3]}
          statusLabel={getStepStatusLabel(stepStatuses[3], "Da avviare")}
          title="Importazione"
        >
          <ExtractedDraftImportSection
            draftCount={
              takeoverActionData?.count ?? draftActionData?.count ?? searchParams.get("count")
            }
            draftMessage={
              takeoverActionData?.message ?? draftActionData?.message ?? searchParams.get("message")
            }
            draftStatus={takeoverQueued ? "queued" : draftStatus}
            isCreatingDrafts={isCreatingDrafts}
            isApplyingTakeover={isApplyingTakeover}
            isSaving={isSaving}
            takeoverStatus={takeoverActionData?.status ?? null}
            wizard={wizard}
          />
        </Step>
        <Step
          index={5}
          isLast
          status={stepStatuses[4]}
          statusLabel={getStepStatusLabel(stepStatuses[4], "Da fare ora")}
          title="Dopo l'import"
        >
          <ExtractedAfterImportSection wizard={wizard} />
        </Step>
      </ol>
      <s-box paddingBlockStart="base">
        <ExtractedImportTechnicalDetails
          previewModeLabel={previewModeLabel}
          selectedLocationName={selectedLocation?.name}
          visibleRuntimePhases={visibleRuntimePhases}
          wizard={wizard}
        />
      </s-box>
    </s-page>
  );
}

function getStepStatusLabel(status: StepStatus, activeLabel: string) {
  if (status === "completed") return "Completato";
  if (status === "active") return activeLabel;

  return "In attesa";
}

export const headers = embeddedNoStoreHeaders;

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
    ? "limite 1.0 raggiunto"
    : "store sotto il limite 1.0 o lettura completata";

  return `${result.batchCount} batch; ${result.createdJobCount} nuovi, ${result.requeuedJobCount} ripianificati, ${result.resumedJobCount} ripresi, ${result.existingJobCount} già presenti; ${totalLabel}; ${capLabel}.`;
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

function hasSessionScope(scopes: string | null | undefined, requiredScope: string) {
  return Boolean(
    scopes
      ?.split(",")
      .map((scope) => scope.trim())
      .includes(requiredScope),
  );
}

function getPreviewModeLabel(mode: string) {
  if (mode === "mock") return "dati dimostrativi fittizi";
  if (mode === "live") return "lettura live eBay";
  if (mode === "empty") return "nessun dato";

  return mode;
}

function getPreviewReadLabel(source: string) {
  if (source === "inventory_api") return "Elementi Inventory API letti";
  if (source === "trading_api") return "Elementi Trading API letti";
  if (source === "deferred") return "Nessuna lettura eBay all'apertura";
  if (source === "mock") return "Elementi mock letti";

  return "Elementi letti";
}
