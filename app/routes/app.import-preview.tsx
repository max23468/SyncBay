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
  createShopifyDraftProductsIfEnabled,
  type ShopifyDraftImportStatus,
} from "../services/shopify-draft-import.server";
import {
  getImportWizardState,
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
    };
  };
  errors?: unknown;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locationResult = await fetchShopifyLocations(admin);
  const wizard = await getImportWizardState(session);

  return {
    locationError: locationResult.errorMessage,
    locations: locationResult.locations,
    wizard,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
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

  await updateDefaultShopifyLocation(session, locationGid, locationResult.locations);

  throw redirect("/app/import-preview?updated=location");
};

export default function ImportPreview() {
  const { locationError, locations, wizard } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const selectedLocation = locations.find(
    (location) => location.id === wizard.shop.defaultLocationGid,
  );
  const isSaving = navigation.state !== "idle";
  const isReadyForPreview = wizard.importPreview.blockers.length === 0;
  const draftStatus = searchParams.get("draft") as ShopifyDraftImportStatus | null;

  return (
    <s-page heading="Preview import">
      <s-section heading="Preparazione">
        <s-paragraph>
          Negozio: {wizard.shop.domain}. La preview resta in sola lettura finché
          non sono pronti account eBay, location Shopify e lettura listing.
        </s-paragraph>
        {searchParams.get("updated") === "location" ? (
          <s-paragraph>Location Shopify predefinita salvata.</s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Location Shopify">
        {locationError ? (
          <s-paragraph>{locationError}</s-paragraph>
        ) : locations.length > 0 ? (
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
                  {location.fulfillsOnlineOrders ? "" : " - fulfillment online non attivo"}
                </option>
              ))}
            </select>
            <s-button type="submit" disabled={isSaving}>
              {isSaving ? "Salvataggio..." : "Salva location"}
            </s-button>
          </form>
        ) : (
          <s-paragraph>
            Nessuna location Shopify leggibile con gli scope attuali.
          </s-paragraph>
        )}
      </s-section>

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

      <s-section heading="Stato preview">
        {isReadyForPreview ? (
          <s-paragraph>Preview pronta per la prossima implementazione.</s-paragraph>
        ) : (
          <s-unordered-list>
            {wizard.importPreview.blockers.map((blocker) => (
              <s-list-item key={blocker}>{blocker}</s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>

      <s-section heading="Dry-run">
        <s-paragraph>
          Modalità:{" "}
          {wizard.previewResult.mode === "mock"
            ? "dati dimostrativi fittizi"
            : wizard.previewResult.mode}
          . Nessun prodotto viene creato su Shopify.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            Listing letti: {wizard.previewResult.summary.totalCount}
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

      <s-section heading="Esempi preview">
        {wizard.previewResult.items.length > 0 ? (
          <s-unordered-list>
            {wizard.previewResult.items.map((item) => (
              <s-list-item key={item.itemId}>
                {item.normalized.title}: {item.status} - SKU{" "}
                {item.normalized.sku ?? "mancante"} - {item.issues.length} rilievi
              </s-list-item>
            ))}
          </s-unordered-list>
        ) : (
          <s-paragraph>Nessun listing letto.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Import Shopify draft">
        {draftStatus === "created" ? (
          <s-paragraph>
            Create {searchParams.get("count") ?? "0"} bozze Shopify da dati mock.
          </s-paragraph>
        ) : draftStatus === "blocked" ? (
          <s-paragraph>
            Import draft bloccato: {searchParams.get("message") ?? "requisiti incompleti"}.
          </s-paragraph>
        ) : draftStatus === "failed" ? (
          <s-paragraph>
            Import draft non completato: {searchParams.get("message") ?? "errore Shopify"}.
          </s-paragraph>
        ) : null}
        <s-unordered-list>
          <s-list-item>
            Stato: {wizard.draftImport.enabled ? "abilitato" : "disabilitato"}
          </s-list-item>
          <s-list-item>
            Prodotti importabili: {wizard.draftImport.importableCount}
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
            {isSaving ? "Creazione..." : "Crea bozze mock"}
          </s-button>
        </form>
      </s-section>

      <s-section heading="Validazioni MVP">
        <s-unordered-list>
          {wizard.validationRules.map((rule) => (
            <s-list-item key={rule.code}>
              {rule.label}: {rule.severity}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Riepilogo">
        <s-unordered-list>
          <s-list-item>Marketplace: {wizard.previewPlan.limits.marketplace}</s-list-item>
          <s-list-item>eBay: {wizard.ebay.status}</s-list-item>
          <s-list-item>
            Location salvata: {selectedLocation?.name ?? "non confermata"}
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Sequenza prevista">
        <s-unordered-list>
          {wizard.previewPlan.steps.map((step) => (
            <s-list-item key={step}>{step}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Fasi successive">
        <s-unordered-list>
          {wizard.runtimePhases.map((phase) => (
            <s-list-item key={phase.label}>
              {phase.label}: {phase.status} - {phase.detail}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

async function fetchShopifyLocations(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
) {
  const response = await admin.graphql(`
    #graphql
    query SyncBayLocations {
      locations(first: 50, includeInactive: false) {
        nodes {
          fulfillsOnlineOrders
          id
          isActive
          name
        }
      }
    }
  `);
  const json = (await response.json()) as LocationsQueryResponse;

  if (json.errors) {
    return {
      errorMessage:
        "Location Shopify non leggibili. Verifica che l'app sia reinstallata con lo scope read_locations.",
      locations: [],
    };
  }

  return {
    errorMessage: null,
    locations: json.data?.locations?.nodes ?? [],
  };
}
