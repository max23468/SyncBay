import { Form } from "react-router";
import { ExistingCatalogTakeoverSection } from "./ExistingCatalogTakeoverSection";
import { MetricTile, PaginationNav, StatusRow } from "./SyncBayUi";
import { formatItNumber as formatNumber } from "../lib/syncbay-datetime-format";
import {
  formatExistingCatalogFieldPolicy,
  formatExistingCatalogOperation,
  formatExistingCatalogReason,
  formatExistingCatalogTakeoverStatus,
} from "../lib/syncbay-existing-catalog-copy";
import {
  getImportCatalogModeLabel,
  getImportCatalogModeParam,
  type ImportCatalogMode,
} from "../lib/syncbay-import-catalog-mode";
import { normalizeImportPreviewLoadMode } from "../lib/syncbay-import-preview-mode";
import {
  IMPORT_PREVIEW_PAGE_SIZE,
  normalizeImportPreviewWindowFilter,
  type ImportPreviewWindowFilter,
  type windowImportPreviewResult,
} from "../lib/syncbay-import-preview-window";
import { getPageWindow } from "../lib/syncbay-pagination";
import {
  getEbayConnectionAction,
  getEbayConnectionStatusLabel,
  getProductPublicationModeSummaryLabel,
} from "../lib/syncbay-ui-state";
import type {
  getLocationRenameReadiness,
  ShopifyLocation,
  ShopifyLocationRenameStatus,
} from "../services/shopify-location.server";
import type { getImportWizardState } from "../services/syncbay-import.server";

type ImportWizardState = Awaited<ReturnType<typeof getImportWizardState>>;

type WizardState = Omit<ImportWizardState, "previewResult"> & {
  previewResult: ImportWizardState["previewResult"] & ReturnType<typeof windowImportPreviewResult>;
};

type PreviewSourceState = WizardState["previewSource"];

type LocationRenameState = ReturnType<typeof getLocationRenameReadiness>;

type ImportPreviewFilter = ImportPreviewWindowFilter;

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

const IMPORT_CATALOG_MODES: ImportCatalogMode[] = ["new_products", "existing_catalog"];

export function PreparationSection({
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
    shopDomain,
    status: wizard.ebay.status,
  });

  return (
    <>
      <s-text color="subdued">
        Negozio: {shopDomain}. Stato eBay: {getEbayConnectionStatusLabel(wizard.ebay.status)}.
        SyncBay ti mostra l&apos;anteprima prima di scrivere sul catalogo Shopify.
      </s-text>
      {wizard.ebay.status === "CONNECTED" ? (
        <details className="syncbay-details">
          <summary>Gestisci collegamento</summary>
          {ebayAction.href ? (
            <s-button href={ebayAction.href} target={ebayAction.target}>
              {ebayAction.label}
            </s-button>
          ) : null}
        </details>
      ) : (
        <s-stack direction="inline" gap="small-200">
          {ebayAction.href ? (
            <s-button
              href={ebayAction.href}
              target={ebayAction.target}
              variant={ebayAction.variant}
            >
              {ebayAction.label}
            </s-button>
          ) : null}
        </s-stack>
      )}
      {ebayAction.blockerText ? <s-text color="subdued">{ebayAction.blockerText}</s-text> : null}
      <s-text color="subdued">{getPreviewIntro(previewSource.source)}</s-text>
      {searchParams.get("updated") === "location" ? (
        <s-paragraph>Location Shopify predefinita salvata.</s-paragraph>
      ) : null}
      {locationRenameStatus === "renamed" ? (
        <s-paragraph>
          Location rinominata: {searchParams.get("name") ?? "nome aggiornato"}.
        </s-paragraph>
      ) : locationRenameStatus === "blocked" ? (
        <s-paragraph>
          Rinomina bloccata: {searchParams.get("message") ?? "permessi incompleti"}.
        </s-paragraph>
      ) : locationRenameStatus === "failed" ? (
        <s-paragraph>
          Rinomina non completata: {searchParams.get("message") ?? "errore Shopify"}.
        </s-paragraph>
      ) : null}
    </>
  );
}

export function LocationShopifySection({
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
    <>
      <s-text color="subdued">
        Conferma la location e controlla i default di importazione. La configurazione completa resta
        in Impostazioni.
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
        <s-paragraph>Nessuna location Shopify leggibile con gli scope attuali.</s-paragraph>
      )}
      {selectedLocation ? (
        <details className="syncbay-details">
          <summary>Opzioni avanzate location</summary>
          <LocationRenameForm
            canWriteLocations={locationUiState.canWriteLocations}
            isRenamingLocation={locationUiState.isRenamingLocation}
            isSaving={locationUiState.isSaving}
            locationRename={locationRename}
            selectedLocation={selectedLocation}
          />
        </details>
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
          title="Limiti 1.0"
        />
      </s-stack>
      <s-stack direction="inline" gap="small-200">
        <s-button href="/app/settings">Modifica impostazioni</s-button>
      </s-stack>
    </>
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
      <s-stack gap="base">
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
              {location.fulfillsOnlineOrders ? "" : " - non gestisce ordini online"}
            </s-option>
          ))}
        </s-select>
        <s-stack direction="inline" gap="small-200">
          <s-button type="submit" disabled={isSaving}>
            {isSavingLocation ? "Salvataggio..." : "Salva location"}
          </s-button>
        </s-stack>
      </s-stack>
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
      <s-stack gap="base">
        <s-text-field
          value={selectedLocation.name}
          disabled={!locationRename.canRename || isSaving}
          id="locationName"
          label="Nome location"
          maxLength={80}
          name="locationName"
          required
        />
        <s-stack direction="inline" gap="small-200">
          <s-button type="submit" disabled={!locationRename.canRename || isSaving}>
            {isRenamingLocation ? "Rinomina..." : "Rinomina location"}
          </s-button>
        </s-stack>
        <s-paragraph>{locationRename.nextAction}</s-paragraph>
        {!canWriteLocations ? (
          <>
            <s-paragraph>
              Apri di nuovo SyncBay da Shopify Admin per autorizzare la modifica del nome location.
            </s-paragraph>
            <details className="syncbay-row-details">
              <summary>Dettagli tecnici</summary>
              <s-text color="subdued">Permesso richiesto: `write_locations`.</s-text>
            </details>
          </>
        ) : null}
      </s-stack>
    </Form>
  );
}

export function PreviewStatusSection({
  activeFilter,
  activePage,
  previewModeLabel,
  previewReadLabel,
  searchParams,
  wizard,
}: {
  activeFilter: ImportPreviewFilter;
  activePage: number;
  previewModeLabel: string;
  previewReadLabel: string;
  searchParams: URLSearchParams;
  wizard: WizardState;
}) {
  const errorCount = wizard.previewResult.summary.errorCount;

  return (
    <>
      <s-text color="subdued">{getPreviewStatusMessage(wizard.previewSource)}</s-text>
      <s-text color="subdued">
        Modalità: {previewModeLabel}. {wizard.previewSource.coverageNote}
      </s-text>
      <ImportCatalogModeSelector activeMode={wizard.catalogMode} searchParams={searchParams} />
      <s-stack direction="inline" gap="small-200">
        <s-button href={getImportPreviewLiveHref(wizard.catalogMode)} variant="primary">
          Aggiorna preview live
        </s-button>
      </s-stack>
      {wizard.importPreview.blockers.length > 0 ? (
        <s-paragraph>Blocchi: {wizard.importPreview.blockers.join(", ")}.</s-paragraph>
      ) : null}
      <div className="syncbay-balanced-box-grid">
        <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))">
          <MetricTile
            detail={previewReadLabel}
            icon="import"
            label="Letti da eBay"
            tone="info"
            value={formatNumber(wizard.previewSource.readCount)}
          />
          <MetricTile
            detail="Prodotti in anteprima."
            icon="package"
            label="Totale"
            tone="neutral"
            value={formatNumber(wizard.previewResult.summary.totalCount)}
          />
          <MetricTile
            detail="Pronti per il primo import."
            icon="check-circle"
            label="Importabili"
            tone={wizard.previewResult.summary.importableCount > 0 ? "success" : "neutral"}
            value={formatNumber(wizard.previewResult.summary.importableCount)}
          />
          <MetricTile
            detail="Da correggere o saltare."
            icon="alert-triangle"
            label="Errori"
            tone={errorCount > 0 ? "critical" : "neutral"}
            value={formatNumber(errorCount)}
          />
        </s-grid>
      </div>
      {wizard.previewResult.existingCatalogTakeover ? (
        <ExistingCatalogTakeoverSection report={wizard.previewResult.existingCatalogTakeover} />
      ) : null}
      <ImportPreviewFilterNav
        activeFilter={activeFilter}
        catalogMode={wizard.catalogMode}
        previewMode={wizard.previewResult.mode}
      />
      <PreviewExamplesSection activeFilter={activeFilter} activePage={activePage} wizard={wizard} />
    </>
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
  const previewWindow = wizard.previewResult.window;
  const filteredItems = previewWindow
    ? wizard.previewResult.items
    : filterPreviewItems(wizard.previewResult.items, activeFilter);
  const pagination = getPageWindow({
    page: activePage,
    pageSize: IMPORT_PREVIEW_PAGE_SIZE,
    totalRows: previewWindow?.totalRows ?? filteredItems.length,
  });
  const visibleItems = previewWindow
    ? filteredItems
    : filteredItems.slice(pagination.offset, pagination.offset + pagination.pageSize);

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
              <s-stack direction="inline" gap="base" justifyContent="space-between">
                <s-stack gap="small-200">
                  <s-text type="strong">{item.normalized.title}</s-text>
                  <s-text color="subdued">
                    SKU {item.normalized.sku ?? "mancante"} · immagini {item.normalized.imageCount}{" "}
                    · {formatPreviewIssues(item.issues)} · {item.normalized.qualitySummary}
                  </s-text>
                </s-stack>
                <s-badge tone={getPreviewStatusTone(item.status)}>
                  {formatPreviewStatus(item.status)}
                </s-badge>
              </s-stack>
              <QualityChecklistDetails item={item} />
              <MatchSuggestionDetails
                item={item}
                report={wizard.previewResult.existingCatalogTakeover}
              />
              <DescriptionPreviewDetails item={item} />
            </s-box>
          ))}
          <ImportPreviewPagination
            activeFilter={activeFilter}
            catalogMode={wizard.catalogMode}
            pagination={pagination}
            previewMode={wizard.previewResult.mode}
            totalCatalogRows={wizard.previewResult.summary.totalCount}
          />
        </>
      ) : (
        <s-box border="base" borderColor="base" borderRadius="base" padding="base">
          <s-stack gap="base">
            <s-heading>Nessun elemento in questa vista</s-heading>
            <s-text>Prova con il filtro Tutti o completa i prerequisiti di lettura.</s-text>
          </s-stack>
        </s-box>
      )}
    </s-stack>
  );
}

function QualityChecklistDetails({
  item,
}: {
  item: WizardState["previewResult"]["items"][number];
}) {
  return (
    <details className="syncbay-row-details">
      <summary>Controlli qualità: {item.normalized.qualitySummary}</summary>
      <s-unordered-list>
        {item.normalized.qualityChecklist.map((check) => (
          <s-list-item key={check.code}>{check.label}</s-list-item>
        ))}
      </s-unordered-list>
    </details>
  );
}

function MatchSuggestionDetails({
  item,
  report,
}: {
  item: WizardState["previewResult"]["items"][number];
  report: WizardState["previewResult"]["existingCatalogTakeover"];
}) {
  const suggestion = item.matchSuggestions[0];
  const takeoverRow = report?.rows.find((row) => row.itemId === item.itemId);

  if (!suggestion && !takeoverRow) return null;

  return (
    <details className="syncbay-row-details">
      <summary>
        {takeoverRow
          ? "Stato riallineamento catalogo esistente"
          : "Possibile prodotto Shopify esistente"}
      </summary>
      <s-stack gap="small-200">
        {suggestion ? (
          <>
            <s-text>
              Confidenza {formatMatchConfidence(suggestion.confidence)}:{" "}
              {suggestion.reasons.join(", ")}. Conferma manuale richiesta prima di collegare il
              prodotto.
            </s-text>
            <s-text color="subdued">Prodotto Shopify: {suggestion.productGid}</s-text>
          </>
        ) : null}
        {takeoverRow ? (
          <>
            <s-text>
              Stato riallineamento: {formatExistingCatalogTakeoverStatus(takeoverRow.status)}.
            </s-text>
            {takeoverRow.plannedOperations.length > 0 ? (
              <s-text color="subdued">
                Operazioni:{" "}
                {takeoverRow.plannedOperations.map(formatExistingCatalogOperation).join(", ")}.
              </s-text>
            ) : null}
            {takeoverRow.reasons.length > 0 ? (
              <s-text color="subdued">
                Motivi: {takeoverRow.reasons.map(formatExistingCatalogReason).join(", ")}.
              </s-text>
            ) : null}
            <s-unordered-list>
              {formatExistingCatalogFieldPolicy(takeoverRow.fieldPolicy).map((policyLine) => (
                <s-list-item key={policyLine}>{policyLine}</s-list-item>
              ))}
            </s-unordered-list>
          </>
        ) : null}
      </s-stack>
    </details>
  );
}

function DescriptionPreviewDetails({
  item,
}: {
  item: WizardState["previewResult"]["items"][number];
}) {
  const description = item.normalized;

  if (description.descriptionOriginalLength === 0 && description.descriptionCleanedLength === 0) {
    return null;
  }

  return (
    <details className="syncbay-row-details">
      <summary>
        Descrizione:{" "}
        {description.descriptionWasChanged
          ? `adattata, -${description.descriptionRemovedPercent}%`
          : "invariata"}
      </summary>
      <s-stack gap="small-200">
        <s-text color="subdued">
          Prima: {formatNumber(description.descriptionOriginalLength)} caratteri. Dopo:{" "}
          {formatNumber(description.descriptionCleanedLength)} caratteri. Segnali template:{" "}
          {formatNumber(description.descriptionTemplateSignalCount)}.
        </s-text>
        {description.descriptionOriginalTextExcerpt ? (
          <s-text color="subdued">Originale: {description.descriptionOriginalTextExcerpt}</s-text>
        ) : null}
        {description.descriptionCleanedTextExcerpt ? (
          <s-text>Preview: {description.descriptionCleanedTextExcerpt}</s-text>
        ) : null}
      </s-stack>
    </details>
  );
}

function ImportPreviewPagination({
  activeFilter,
  catalogMode,
  pagination,
  previewMode,
  totalCatalogRows,
}: {
  activeFilter: ImportPreviewFilter;
  catalogMode: ImportCatalogMode;
  pagination: ReturnType<typeof getPageWindow>;
  previewMode: WizardState["previewResult"]["mode"];
  totalCatalogRows: number;
}) {
  return (
    <PaginationNav
      getPageHref={(page) => getImportPreviewHref(activeFilter, page, catalogMode, previewMode)}
      pagination={pagination}
      summary={`Mostrati ${formatNumber(pagination.currentStart)}-${formatNumber(
        pagination.currentEnd,
      )} di ${formatNumber(pagination.totalRows)} elementi${
        activeFilter === "all" ? "" : " per questo filtro"
      }. Anteprima totale: ${formatNumber(totalCatalogRows)}.`}
    />
  );
}

function ImportPreviewFilterNav({
  activeFilter,
  catalogMode,
  previewMode,
}: {
  activeFilter: ImportPreviewFilter;
  catalogMode: ImportCatalogMode;
  previewMode: WizardState["previewResult"]["mode"];
}) {
  return (
    <div className="syncbay-filter-nav">
      <s-stack direction="inline" gap="small-200" accessibilityRole="navigation">
        {IMPORT_PREVIEW_FILTERS.map((filter) => (
          <s-clickable-chip
            aria-current={activeFilter === filter.value ? "page" : undefined}
            color={activeFilter === filter.value ? "strong" : "base"}
            href={getImportPreviewHref(filter.value, 1, catalogMode, previewMode)}
            key={filter.value}
          >
            {filter.label}
          </s-clickable-chip>
        ))}
      </s-stack>
    </div>
  );
}

function ImportCatalogModeSelector({
  activeMode,
  searchParams,
}: {
  activeMode: ImportCatalogMode;
  searchParams: URLSearchParams;
}) {
  // Chip come i filtri delle altre superfici: è una scelta di vista, non
  // un'azione.
  return (
    <s-stack direction="inline" gap="small-200" accessibilityRole="navigation">
      {IMPORT_CATALOG_MODES.map((mode) => (
        <s-clickable-chip
          aria-current={activeMode === mode ? "page" : undefined}
          color={activeMode === mode ? "strong" : "base"}
          href={getImportCatalogModeHref(searchParams, mode)}
          key={mode}
        >
          {getImportCatalogModeLabel(mode)}
        </s-clickable-chip>
      ))}
    </s-stack>
  );
}

function getImportCatalogModeHref(searchParams: URLSearchParams, mode: ImportCatalogMode) {
  const params = new URLSearchParams();
  const previewMode = normalizeImportPreviewLoadMode(searchParams.get("preview"));
  const previewFilter = normalizeImportPreviewWindowFilter(searchParams.get("previewFilter"));

  if (previewMode === "live") params.set("preview", "live");
  if (previewFilter !== "all") params.set("previewFilter", previewFilter);
  params.set("catalogMode", getImportCatalogModeParam(mode));

  return `/app/import-preview?${params.toString()}`;
}

function getImportPreviewLiveHref(catalogMode: ImportCatalogMode) {
  const params = new URLSearchParams({ preview: "live" });

  if (catalogMode !== "new_products") {
    params.set("catalogMode", getImportCatalogModeParam(catalogMode));
  }

  return `/app/import-preview?${params.toString()}`;
}

function getImportPreviewHref(
  filter: ImportPreviewFilter,
  page = 1,
  catalogMode: ImportCatalogMode = "new_products",
  previewMode: WizardState["previewResult"]["mode"] = "empty",
) {
  const params = new URLSearchParams();

  if (previewMode === "live") params.set("preview", "live");
  if (catalogMode !== "new_products") {
    params.set("catalogMode", getImportCatalogModeParam(catalogMode));
  }
  if (filter !== "all") params.set("previewFilter", filter);
  if (page > 1) params.set("previewPage", String(page));

  const queryString = params.toString();

  return queryString ? `/app/import-preview?${queryString}` : "/app/import-preview";
}

function formatPreviewStatus(status: string) {
  if (status === "importable") return "importabile";
  if (status === "skipped") return "saltato";
  if (status === "error") return "da correggere";

  return status;
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

  if (source === "deferred") {
    return "La pagina si apre senza interrogare eBay; aggiorna la preview live quando vuoi leggere i listing in sola lettura.";
  }

  return "La preview mock usa dati fittizi e resta in sola lettura finché non viene confermata una scrittura esplicita su Shopify.";
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

  if (source.source === "deferred") {
    return "Preview live non ancora aggiornata in questa apertura.";
  }

  return "Preview mock pronta: puoi verificare conteggi, validazioni e messaggi senza collegamenti esterni.";
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

function formatMatchConfidence(value: string) {
  if (value === "high") return "alta";
  if (value === "medium") return "media";

  return "bassa";
}
