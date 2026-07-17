import type { ProductPublicationMode as PrismaProductPublicationMode } from "@prisma/client";

export const PRODUCT_PUBLICATION_MODES = [
  "ALL",
  "SELECTED",
  "NONE",
] as const satisfies readonly PrismaProductPublicationMode[];

export type ProductPublicationMode = PrismaProductPublicationMode;

type MissingPrismaProductPublicationMode = Exclude<
  PrismaProductPublicationMode,
  (typeof PRODUCT_PUBLICATION_MODES)[number]
>;
type AssertNoMissingProductPublicationMode<T extends never> = T;
/**
 * Asserzione di compile-time: fallisce se Prisma aggiunge un valore non coperto
 * da PRODUCT_PUBLICATION_MODES. Nessuno la importa: va tenuta, non è codice morto.
 * @knipignore
 */
export type ProductPublicationModesCoverPrisma =
  AssertNoMissingProductPublicationMode<MissingPrismaProductPublicationMode>;

const PRODUCT_PUBLICATION_MODE_SET: ReadonlySet<string> = new Set(
  PRODUCT_PUBLICATION_MODES,
);

export function normalizeProductPublicationMode(
  value: string | null | undefined,
): ProductPublicationMode {
  return isProductPublicationMode(value) ? value : "ALL";
}

function isProductPublicationMode(
  value: string | null | undefined,
): value is ProductPublicationMode {
  return typeof value === "string" && PRODUCT_PUBLICATION_MODE_SET.has(value);
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

export function resolveStoredSelectedProductPublicationIds(input: {
  selectedPublicationIds: string[];
}):
  | {
      publicationIds: string[];
      status: "ready";
    }
  | {
      errorMessage: string;
      status: "failed";
    } {
  const publicationIds = dedupePublicationIds(input.selectedPublicationIds);

  if (publicationIds.length === 0) {
    return {
      errorMessage:
        "Nessuno dei canali Shopify selezionati è disponibile per questo negozio.",
      status: "failed",
    };
  }

  return {
    publicationIds,
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
