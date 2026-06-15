import type { Prisma } from "@prisma/client";

export function formatConflictValueForDisplay(input: {
  field: string;
  value: Prisma.JsonValue | null;
}) {
  if (input.value === null) return "Non disponibile";

  if (input.field === "description" && isDescriptionHash(input.value)) {
    return "Descrizione modificata a mano (testo completo non mostrato qui).";
  }

  if (input.field === "images" && typeof input.value === "number") {
    return `${input.value} ${input.value === 1 ? "immagine" : "immagini"}`;
  }

  if (input.field === "price") {
    const priceLabel = formatPriceConflictValue(input.value);

    if (priceLabel) return priceLabel;
  }

  if (typeof input.value === "string") return truncateDisplayValue(input.value);
  if (typeof input.value === "number" || typeof input.value === "boolean") {
    return String(input.value);
  }
  if (Array.isArray(input.value)) {
    if (input.value.length === 0) return "Nessun valore";

    return `${input.value.length} valori`;
  }

  const object = getJsonObject(input.value);
  const knownValue =
    getJsonString(object?.title) ??
    getJsonString(object?.name) ??
    getJsonString(object?.value) ??
    getJsonString(object?.amount);

  return knownValue ? truncateDisplayValue(knownValue) : "Valore strutturato";
}

function formatPriceConflictValue(value: Prisma.JsonValue) {
  const object = getJsonObject(value);

  if (!object) return null;

  const amount = getJsonString(object.amount);
  const compareAtPrice = getJsonString(object.compareAtPrice);

  if (amount && compareAtPrice) {
    return `${amount} (prezzo barrato ${compareAtPrice})`;
  }

  return amount ?? null;
}

function isDescriptionHash(value: Prisma.JsonValue) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim());
}

function truncateDisplayValue(value: string) {
  const trimmedValue = value.trim();

  return trimmedValue.length > 96
    ? `${trimmedValue.slice(0, 93).trimEnd()}...`
    : trimmedValue;
}

function getJsonObject(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function getJsonString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
