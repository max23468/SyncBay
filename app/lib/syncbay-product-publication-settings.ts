export const PRODUCT_PUBLICATION_MODES = [
  "ALL",
  "SELECTED",
  "NONE",
] as const;

export type ProductPublicationMode = (typeof PRODUCT_PUBLICATION_MODES)[number];

export function normalizeProductPublicationMode(
  value: string | null | undefined,
): ProductPublicationMode {
  return PRODUCT_PUBLICATION_MODES.includes(value as ProductPublicationMode)
    ? (value as ProductPublicationMode)
    : "ALL";
}

export function parseProductPublicationGids(value: string | null | undefined) {
  return dedupePublicationIds(
    value
      ? value.split(",").flatMap((publicationId) => {
          const trimmed = publicationId.trim();
          return trimmed ? [trimmed] : [];
        })
      : [],
  );
}

export function serializeProductPublicationGids(publicationIds: string[]) {
  return dedupePublicationIds(publicationIds).join(",");
}

export function resolveProductPublicationIds(input: {
  availablePublicationIds: string[];
  mode: ProductPublicationMode;
  selectedPublicationIds: string[];
}):
  | {
      publicationIds: string[];
      status: "disabled" | "ready";
    }
  | {
      errorMessage: string;
      status: "failed";
    } {
  if (input.mode === "NONE") {
    return {
      publicationIds: [],
      status: "disabled",
    };
  }

  const availablePublicationIds = dedupePublicationIds(
    input.availablePublicationIds,
  );

  if (input.mode === "ALL") {
    return {
      publicationIds: availablePublicationIds,
      status: "ready",
    };
  }

  const availableSet = new Set(availablePublicationIds);
  const selectedAvailableIds = dedupePublicationIds(
    input.selectedPublicationIds.filter((publicationId) =>
      availableSet.has(publicationId),
    ),
  );

  if (selectedAvailableIds.length === 0) {
    return {
      errorMessage:
        "Nessuno dei canali Shopify selezionati è disponibile per questo negozio.",
      status: "failed",
    };
  }

  return {
    publicationIds: selectedAvailableIds,
    status: "ready",
  };
}

function dedupePublicationIds(publicationIds: string[]) {
  return [
    ...new Set(
      publicationIds.flatMap((publicationId) => {
        const trimmed = publicationId.trim();
        return trimmed ? [trimmed] : [];
      }),
    ),
  ];
}
