import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  getLocationRenameReadiness,
  renameShopifyLocation,
  type ShopifyLocationRenameStatus,
} from "../services/shopify-location.server";
import {
  createShopifyDraftProductsIfEnabled,
  type ShopifyDraftImportStatus,
} from "../services/shopify-draft-import.server";
import {
  getImportWizardState,
  recordShopifyLocationRenamed,
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
    const wizard = await getImportWizardState(session);
    const result = await createShopifyDraftProductsIfEnabled({
      admin,
      hasDefaultLocation: Boolean(wizard.shop.defaultLocationGid),
      previewResult: wizard.previewResult,
    });

    const params = new URLSearchParams({
      draft: result.status,
    });

    if (result.status === "created") {
      params.set("count", String(result.createdProducts.length));
    } else if (result.status === "failed" && result.errorMessage) {
      params.set("message", result.errorMessage);
    } else if (result.status === "blocked") {
      params.set("message", result.readiness.blockers.join(", "));
    }

    throw redirect(`/app/import-preview?${params.toString()}`);
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
  const draftStatus = searchParams.get(
    "draft",
  ) as ShopifyDraftImportStatus | null;
  const locationRenameStatus = searchParams.get(
    "locationRename",
  ) as ShopifyLocationRenameStatus | null;
  const visibleRuntimePhases = wizard.runtimePhases.filter(
    (phase) =>
      !phase.label.toLowerCase().includes("ebay") &&
      !phase.detail.toLowerCase().includes("ebay"),
  );

  return (
    <s-page heading="Preview import">
      <PreparationSection
        locationRenameStatus={locationRenameStatus}
        previewSource={wizard.previewSource}
        searchParams={searchParams}
        shopDomain={wizard.shop.domain}
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
      <DefaultImportSection wizard={wizard} />
      <PreviewStatusSection wizard={wizard} />
      <DryRunSection
        previewModeLabel={previewModeLabel}
        previewReadLabel={previewReadLabel}
        wizard={wizard}
      />
      <PreviewExamplesSection wizard={wizard} />
      <DraftImportSection
        draftStatus={draftStatus}
        isCreatingDrafts={isCreatingDrafts}
        isSaving={isSaving}
        searchParams={searchParams}
        wizard={wizard}
      />
      <ValidationSection wizard={wizard} />
      <AsideSections
        previewModeLabel={previewModeLabel}
        selectedLocation={selectedLocation}
        visibleRuntimePhases={visibleRuntimePhases}
        wizard={wizard}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type WizardState = LoaderData["wizard"];
type PreviewSourceState = WizardState["previewSource"];
type LocationRenameState = LoaderData["locationRename"];
type RuntimePhaseState = WizardState["runtimePhases"][number];

function PreparationSection({
  locationRenameStatus,
  previewSource,
  searchParams,
  shopDomain,
}: {
  locationRenameStatus: ShopifyLocationRenameStatus | null;
  previewSource: PreviewSourceState;
  searchParams: URLSearchParams;
  shopDomain: string;
}) {
  return (
    <s-section heading="Preparazione">
      <s-paragraph>
        Negozio: {shopDomain}. {getPreviewIntro(previewSource.source)}
      </s-paragraph>
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
    <s-section heading="Location Shopify">
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
    <form method="post">
      <input type="hidden" name="intent" value="saveLocation" />
      <label htmlFor="defaultLocationGid">Location predefinita</label>
      <select
        defaultValue={wizard.shop.defaultLocationGid ?? locations[0]?.id ?? ""}
        id="defaultLocationGid"
        name="defaultLocationGid"
      >
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
            {location.isActive ? "" : " - non attiva"}
            {location.fulfillsOnlineOrders
              ? ""
              : " - fulfillment online non attivo"}
          </option>
        ))}
      </select>
      <s-button type="submit" disabled={isSaving}>
        {isSavingLocation ? "Salvataggio..." : "Salva location"}
      </s-button>
    </form>
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
    <form method="post">
      <input type="hidden" name="intent" value="renameLocation" />
      <input type="hidden" name="locationGid" value={selectedLocation.id} />
      <label htmlFor="locationName">Nome location</label>
      <input
        aria-label="Nome location Shopify"
        defaultValue={selectedLocation.name}
        disabled={!locationRename.canRename || isSaving}
        id="locationName"
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
    </form>
  );
}

function DefaultImportSection({ wizard }: { wizard: WizardState }) {
  return (
    <s-section heading="Default import">
      <s-unordered-list>
        <s-list-item>
          Stato prodotti: {wizard.importPreview.defaults.productStatus}
        </s-list-item>
        <s-list-item>
          Immagini: {wizard.importPreview.defaults.imageImport}
        </s-list-item>
        <s-list-item>
          Descrizioni: {wizard.importPreview.defaults.descriptionMode}
        </s-list-item>
        <s-list-item>
          Limite MVP: {wizard.previewPlan.limits.maxProducts} prodotti per shop
        </s-list-item>
      </s-unordered-list>
    </s-section>
  );
}

function PreviewStatusSection({ wizard }: { wizard: WizardState }) {
  return (
    <s-section heading="Stato preview">
      <s-paragraph>{getPreviewStatusMessage(wizard.previewSource)}</s-paragraph>
      <s-paragraph>{wizard.previewSource.coverageNote}</s-paragraph>
      {wizard.importPreview.blockers.length > 0 ? (
        <s-paragraph>
          Blocchi: {wizard.importPreview.blockers.join(", ")}.
        </s-paragraph>
      ) : null}
    </s-section>
  );
}

function DryRunSection({
  previewModeLabel,
  previewReadLabel,
  wizard,
}: {
  previewModeLabel: string;
  previewReadLabel: string;
  wizard: WizardState;
}) {
  return (
    <s-section heading="Dry-run">
      <s-paragraph>
        Modalità: {previewModeLabel}. Nessun prodotto viene creato su Shopify.
      </s-paragraph>
      <s-unordered-list>
        <s-list-item>
          {previewReadLabel}: {wizard.previewSource.readCount}
        </s-list-item>
        {wizard.previewSource.source !== "mock" ? (
          <>
            <s-list-item>
              Inventory API letti: {wizard.previewSource.readCounts.inventoryApi}
            </s-list-item>
            <s-list-item>
              Trading API letti: {wizard.previewSource.readCounts.tradingApi}
            </s-list-item>
          </>
        ) : null}
        <s-list-item>
          Elementi in preview: {wizard.previewResult.summary.totalCount}
        </s-list-item>
        {wizard.previewSource.totalAvailable !== null ? (
          <s-list-item>
            Totale disponibile dalla fonte:{" "}
            {wizard.previewSource.totalAvailable}
          </s-list-item>
        ) : null}
        <s-list-item>
          Fonte: {formatPreviewSource(wizard.previewSource.source)}
        </s-list-item>
        <s-list-item>
          Importabili: {wizard.previewResult.summary.importableCount}
        </s-list-item>
        <s-list-item>
          Saltati: {wizard.previewResult.summary.skippedCount}
        </s-list-item>
        <s-list-item>
          Errori: {wizard.previewResult.summary.errorCount}
        </s-list-item>
        <s-list-item>
          Warning: {wizard.previewResult.summary.warningCount}
        </s-list-item>
      </s-unordered-list>
    </s-section>
  );
}

function PreviewExamplesSection({ wizard }: { wizard: WizardState }) {
  return (
    <s-section heading="Esempi preview">
      {wizard.previewResult.items.length > 0 ? (
        <s-unordered-list>
          {wizard.previewResult.items.map((item) => (
            <s-list-item key={item.itemId}>
              {item.normalized.title}: {formatPreviewStatus(item.status)} - SKU{" "}
              {item.normalized.sku ?? "mancante"} - immagini{" "}
              {item.normalized.imageCount} - {formatPreviewIssues(item.issues)}
            </s-list-item>
          ))}
        </s-unordered-list>
      ) : (
        <s-paragraph>
          Nessun elemento letto dalla fonte preview corrente.
        </s-paragraph>
      )}
    </s-section>
  );
}

function DraftImportSection({
  draftStatus,
  isCreatingDrafts,
  isSaving,
  searchParams,
  wizard,
}: {
  draftStatus: ShopifyDraftImportStatus | null;
  isCreatingDrafts: boolean;
  isSaving: boolean;
  searchParams: URLSearchParams;
  wizard: WizardState;
}) {
  return (
    <s-section heading="Import Shopify draft">
      {draftStatus === "created" ? (
        <s-paragraph>
          Create {searchParams.get("count") ?? "0"} bozze Shopify dalla preview.
        </s-paragraph>
      ) : draftStatus === "blocked" ? (
        <s-paragraph>
          Import draft bloccato:{" "}
          {searchParams.get("message") ?? "requisiti incompleti"}.
        </s-paragraph>
      ) : draftStatus === "failed" ? (
        <s-paragraph>
          Import draft non completato:{" "}
          {searchParams.get("message") ?? "errore Shopify"}.
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
          Bozze previste: {wizard.draftImport.plannedCreateCount}
        </s-list-item>
        <s-list-item>{wizard.draftImport.nextAction}</s-list-item>
        {wizard.draftImport.blockers.length > 0 ? (
          <s-list-item>
            Blocchi: {wizard.draftImport.blockers.join(", ")}
          </s-list-item>
        ) : null}
      </s-unordered-list>
      <form method="post">
        <input type="hidden" name="intent" value="createDraftProducts" />
        <s-button
          type="submit"
          disabled={isSaving || wizard.draftImport.blockers.length > 0}
        >
          {isCreatingDrafts ? "Creazione..." : "Crea bozze da preview"}
        </s-button>
      </form>
    </s-section>
  );
}

function ValidationSection({ wizard }: { wizard: WizardState }) {
  return (
    <s-section heading="Validazioni MVP">
      <s-unordered-list>
        {wizard.validationRules.map((rule) => (
          <s-list-item key={rule.code}>
            {rule.label}: {rule.severity}
          </s-list-item>
        ))}
      </s-unordered-list>
    </s-section>
  );
}

function AsideSections({
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
    <>
      <s-section slot="aside" heading="Riepilogo">
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
      </s-section>
      <s-section slot="aside" heading="Sequenza preview">
        <s-unordered-list>
          <s-list-item>
            {getPreviewFirstStep(wizard.previewSource.source)}
          </s-list-item>
          <s-list-item>
            Validare SKU, immagini, prezzo e disponibilità.
          </s-list-item>
          <s-list-item>
            Mostrare prodotti importabili, errori e warning.
          </s-list-item>
          <s-list-item>
            Tenere ogni scrittura Shopify dietro conferma.
          </s-list-item>
        </s-unordered-list>
      </s-section>
      <s-section slot="aside" heading="Fasi Shopify">
        <s-unordered-list>
          {visibleRuntimePhases.map((phase) => (
            <s-list-item key={phase.label}>
              {phase.label}: {phase.status} - {phase.detail}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </>
  );
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

function getPreviewFirstStep(source: string) {
  if (source === "inventory_api") {
    return "Leggere inventory item e offer pubblicate da eBay.";
  }

  if (source === "trading_api") {
    return "Leggere listing attivi con fallback Trading API.";
  }

  return "Leggere dati dimostrativi fittizi.";
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
