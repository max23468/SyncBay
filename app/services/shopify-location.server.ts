interface ShopifyAdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface LocationEditResponse {
  data?: {
    locationEdit?: {
      location?: {
        id: string;
        name: string;
      } | null;
      userErrors?: Array<{
        field?: string[] | null;
        message: string;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

export type ShopifyLocationRenameStatus = "blocked" | "failed" | "renamed";

export function getLocationRenameReadiness(input: {
  canWriteLocations: boolean;
  hasDefaultLocation: boolean;
  selectedLocationName?: string | null;
}) {
  const blockers = [
    !input.hasDefaultLocation ? "location Shopify predefinita non confermata" : null,
    !input.canWriteLocations ? "scope write_locations non ancora concesso" : null,
    !input.selectedLocationName ? "location selezionata non leggibile" : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    blockers,
    canRename: blockers.length === 0,
    nextAction:
      blockers.length > 0
        ? "Riapprova i permessi Shopify e conferma una location prima di rinominarla."
        : "Puoi rinominare la location selezionata da SyncBay.",
  };
}

export async function renameShopifyLocation(input: {
  admin: ShopifyAdminGraphqlClient;
  canWriteLocations: boolean;
  locationGid: string;
  name: string;
}) {
  const normalizedName = normalizeLocationName(input.name);
  const blockers = [
    !input.canWriteLocations ? "scope write_locations non ancora concesso" : null,
    !input.locationGid ? "location Shopify non selezionata" : null,
    !normalizedName ? "nome location mancante" : null,
    normalizedName && normalizedName.length > 80
      ? "nome location troppo lungo"
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  if (blockers.length > 0) {
    return {
      blockers,
      location: null,
      status: "blocked" as const,
    };
  }

  const response = await input.admin.graphql(
    `#graphql
    mutation SyncBayRenameLocation($id: ID!, $input: LocationEditInput!) {
      locationEdit(id: $id, input: $input) {
        location {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: input.locationGid,
        input: {
          name: normalizedName,
        },
      },
    },
  );
  const json = (await response.json()) as LocationEditResponse;

  if (json.errors?.length) {
    return {
      errorMessage: json.errors.map((error) => error.message).join("; "),
      location: null,
      status: "failed" as const,
    };
  }

  const userErrors = json.data?.locationEdit?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      errorMessage: userErrors.map((error) => error.message).join("; "),
      location: null,
      status: "failed" as const,
    };
  }

  const location = json.data?.locationEdit?.location ?? null;
  if (!location) {
    return {
      errorMessage: "Shopify non ha restituito la location aggiornata.",
      location: null,
      status: "failed" as const,
    };
  }

  return {
    location,
    status: "renamed" as const,
  };
}

function normalizeLocationName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}
