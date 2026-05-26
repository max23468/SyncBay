import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  getImportProductStatusLabelCapitalized,
  IMPORT_PRODUCT_STATUS_VALUES,
  type ImportProductStatus,
} from "../lib/import-product-status";
import { authenticate } from "../shopify.server";
import {
  getShopSettingsState,
  updateDefaultImportProductStatus,
} from "../services/syncbay.server";

type SettingsActionData = {
  defaultProductStatus: ImportProductStatus;
  intent: "saveImportDefaults";
  message: string;
  status: "saved";
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return getShopSettingsState(session);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const [{ session }, formData] = await Promise.all([
    authenticate.admin(request),
    request.formData(),
  ]);
  const intent = String(formData.get("intent") ?? "");

  if (intent !== "saveImportDefaults") {
    throw new Response("Azione impostazioni non supportata.", { status: 400 });
  }

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
};

export default function SettingsRoute() {
  const settings = useLoaderData<typeof loader>();
  const actionData = useActionData() as SettingsActionData | undefined;
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";
  const currentStatus =
    actionData?.defaultProductStatus ?? settings.shop.defaultProductStatus;

  return (
    <s-page heading="Impostazioni">
      <s-section heading="Import prodotti">
        <s-paragraph>Negozio: {settings.shop.domain}.</s-paragraph>
        <s-paragraph>
          Il default si applica ai nuovi prodotti creati dai prossimi import.
          I prodotti già importati o riusati non vengono ripubblicati o messi in
          bozza automaticamente.
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
            {isSaving ? "Salvataggio..." : "Salva impostazioni"}
          </s-button>
        </Form>
      </s-section>

      <s-section heading="Collegamenti rapidi">
        <s-button href="/app">Torna alla dashboard</s-button>
        <s-button href="/app/import-preview">Apri preview import</s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
