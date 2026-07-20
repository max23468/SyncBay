import { Form } from "react-router";

import {
  getImportedProductsLabel,
  getImportedProductSingularLabel,
  type ImportProductStatus,
} from "../lib/import-product-status";
import {
  getCatalogModeDraftImportBlocker,
  getImportCatalogModeParam,
} from "../lib/syncbay-import-catalog-mode";
import { getProductPublicationModeSummaryLabel } from "../lib/syncbay-ui-state";
import type { ShopifyDraftImportStatus } from "../services/shopify-draft-import.server";

interface ImportExecutionWizard {
  catalogMode: "existing_catalog" | "new_products";
  draftImport: {
    blockers: string[];
    draftLimit: number;
    enabled: boolean;
    importProductStatus: ImportProductStatus;
    importableCount: number;
    nextAction: string;
    plannedCreateCount: number;
  };
  importPreview: { defaults: { productStatus: string } };
  previewPlan: { limits: { maxProducts: number } };
  previewResult: {
    existingCatalogTakeover?: {
      summary: { applicable: number; blocked: number; review: number };
    } | null;
  };
  previewSource: { source: string };
  productPublications: { mode: string; selectedCount: number };
  runtimePhases: Array<{ detail: string; label: string; status: string }>;
  validationRules: Array<{ code: string; label: string; severity: string }>;
}

export function DraftImportSection({
  draftCount,
  draftMessage,
  draftStatus,
  isApplyingTakeover,
  isCreatingDrafts,
  isSaving,
  takeoverStatus,
  wizard,
}: {
  draftCount?: number | string | null;
  draftMessage?: string | null;
  draftStatus: ShopifyDraftImportStatus | null;
  isApplyingTakeover: boolean;
  isCreatingDrafts: boolean;
  isSaving: boolean;
  takeoverStatus: "blocked" | "queued" | null;
  wizard: ImportExecutionWizard;
}) {
  const catalogModeBlocker = getCatalogModeDraftImportBlocker(wizard.catalogMode);
  const report = wizard.previewResult.existingCatalogTakeover;
  const existing = wizard.catalogMode === "existing_catalog";
  const takeoverBlocked = !report || report.summary.applicable === 0 || report.summary.blocked > 0;

  return (
    <>
      <s-text color="subdued">
        {existing
          ? "Il catalogo esistente resta in simulazione: l'import normale è disattivato per evitare duplicati."
          : "Avvia la creazione o il riuso dei prodotti Shopify dopo aver controllato anteprima, location e impostazioni."}
      </s-text>
      {draftStatus === "created" ? (
        <s-paragraph>
          Operazione completata:{" "}
          {formatDraftImportCount(draftCount, wizard.draftImport.importProductStatus)}
          {draftMessage ? ` ${draftMessage}` : null}
        </s-paragraph>
      ) : draftStatus === "queued" ? (
        <s-paragraph>
          {existing ? "Takeover pianificato" : "Import pianificato"}:{" "}
          {existing
            ? formatTakeoverApplyCount(draftCount)
            : formatDraftImportCount(draftCount, wizard.draftImport.importProductStatus)}
          {draftMessage ? ` ${draftMessage}` : null}
        </s-paragraph>
      ) : draftStatus === "blocked" || draftStatus === "failed" ? (
        <s-paragraph>
          Import Shopify non completato: {draftMessage ?? "requisiti incompleti"}.
        </s-paragraph>
      ) : takeoverStatus === "blocked" ? (
        <s-paragraph>
          Takeover catalogo esistente bloccato: {draftMessage ?? "requisiti incompleti"}.
        </s-paragraph>
      ) : null}
      <s-unordered-list>
        <s-list-item>
          Stato: {wizard.draftImport.enabled ? "abilitato" : "disabilitato"}
        </s-list-item>
        {existing ? (
          <>
            <s-list-item>Righe applicabili: {report?.summary.applicable ?? 0}</s-list-item>
            <s-list-item>Righe da rivedere: {report?.summary.review ?? 0}</s-list-item>
            <s-list-item>Righe bloccanti: {report?.summary.blocked ?? 0}</s-list-item>
          </>
        ) : (
          <>
            <s-list-item>Prodotti importabili: {wizard.draftImport.importableCount}</s-list-item>
            <s-list-item>Limite batch operativo: {wizard.draftImport.draftLimit}</s-list-item>
            <s-list-item>Prodotti previsti: {wizard.draftImport.plannedCreateCount}</s-list-item>
            <s-list-item>Limite 1.0: {wizard.previewPlan.limits.maxProducts} prodotti</s-list-item>
          </>
        )}
        <s-list-item>{wizard.draftImport.nextAction}</s-list-item>
        {wizard.draftImport.blockers.length ? (
          <s-list-item>Blocchi: {wizard.draftImport.blockers.join(", ")}</s-list-item>
        ) : null}
        {catalogModeBlocker ? (
          <s-list-item>Modalità catalogo: {catalogModeBlocker}</s-list-item>
        ) : null}
      </s-unordered-list>
      {existing ? (
        <Form method="post">
          <input type="hidden" name="intent" value="applyExistingCatalogTakeover" />
          <s-stack gap="small">
            <s-text-field
              id="existingCatalogTakeoverConfirmation"
              label="Conferma takeover"
              name="confirmation"
              placeholder="COLLEGA"
              required
            ></s-text-field>
            <s-text-field
              label="Tag legacy da rimuovere"
              name="legacyTagsToRemove"
              placeholder="Tag esatto 1, Tag esatto 2"
            ></s-text-field>
          </s-stack>
          <s-button
            type="submit"
            variant="primary"
            disabled={isSaving || takeoverBlocked || wizard.draftImport.blockers.length > 0}
          >
            {isApplyingTakeover ? "Pianificazione in corso..." : "Applica takeover righe sicure"}
          </s-button>
        </Form>
      ) : (
        <Form method="post">
          <input type="hidden" name="intent" value="createDraftProducts" />
          <input
            type="hidden"
            name="catalogMode"
            value={getImportCatalogModeParam(wizard.catalogMode)}
          />
          <s-button
            type="submit"
            disabled={
              isSaving || Boolean(catalogModeBlocker) || wizard.draftImport.blockers.length > 0
            }
          >
            {catalogModeBlocker
              ? "Riallineamento in simulazione"
              : isCreatingDrafts
                ? "Avvio in corso..."
                : "Avvia import catalogo"}
          </s-button>
        </Form>
      )}
    </>
  );
}

export function AfterImportSection({ wizard }: { wizard: ImportExecutionWizard }) {
  return (
    <>
      <s-text color="subdued">
        Una volta avviato l&apos;import puoi controllare i prodotti collegati nel Catalogo e
        completare eventuali canali o default dalle Impostazioni.
      </s-text>
      <s-stack direction="inline" gap="small-200">
        <s-button href="/app/catalog" variant="primary">
          Vai al catalogo
        </s-button>
        <s-button href="/app/settings">Modifica impostazioni</s-button>
      </s-stack>
      <s-text color="subdued">
        Default prodotti: {wizard.importPreview.defaults.productStatus}. Canali:{" "}
        {getProductPublicationModeSummaryLabel(
          wizard.productPublications.mode,
          wizard.productPublications.selectedCount,
        )}
        .
      </s-text>
    </>
  );
}

export function ImportTechnicalDetails({
  previewModeLabel,
  selectedLocationName,
  visibleRuntimePhases,
  wizard,
}: {
  previewModeLabel: string;
  selectedLocationName?: string;
  visibleRuntimePhases: ImportExecutionWizard["runtimePhases"];
  wizard: ImportExecutionWizard;
}) {
  return (
    <s-section heading="Dettagli tecnici">
      <details className="syncbay-details">
        <summary>Apri dettagli importazione</summary>
        <s-stack gap="base">
          <s-unordered-list>
            <s-list-item>Modalità preview: {previewModeLabel}</s-list-item>
            <s-list-item>Fonte: {formatPreviewSource(wizard.previewSource.source)}</s-list-item>
            <s-list-item>Location salvata: {selectedLocationName ?? "non confermata"}</s-list-item>
            <s-list-item>Scritture Shopify: solo dopo conferma esplicita</s-list-item>
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

function formatDraftImportCount(
  count: number | string | null | undefined,
  status: ImportProductStatus,
) {
  const value = count ?? "0";

  return String(value) === "1"
    ? `${value} ${getImportedProductSingularLabel(status)} gestito dalla preview.`
    : `${value} ${getImportedProductsLabel(status)} gestiti dalla preview.`;
}

function formatTakeoverApplyCount(count: number | string | null | undefined) {
  const value = Number.parseInt(String(count ?? 0), 10) || 0;

  return value === 1 ? "1 riga sicura" : `${value} righe sicure`;
}

function formatPreviewSource(source: string) {
  return source === "trading_api"
    ? "eBay Trading API"
    : source === "inventory_api"
      ? "eBay Inventory API"
      : source === "fixture"
        ? "fixture sintetica"
        : source;
}
