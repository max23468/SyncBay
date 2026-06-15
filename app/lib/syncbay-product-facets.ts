export type SyncBayProductFacetKey =
  | "categoria"
  | "area_stato"
  | "materiale"
  | "conservazione"
  | "perizia";

export interface EbayItemSpecific {
  name: string;
  values: string[];
}

export interface SyncBayProductFacet {
  key: SyncBayProductFacetKey;
  label: string;
  namespace: "syncbay_facets";
  type: "single_line_text_field" | "list.single_line_text_field";
  value: string;
}

export interface ShopifyProductFacetMetafield {
  key: SyncBayProductFacetKey;
  namespace: "syncbay_facets";
  type: "single_line_text_field" | "list.single_line_text_field";
  value: string;
}

export interface SyncBayProductFacetInput {
  ebayPrimaryCategoryName?: string | null;
  itemSpecifics?: EbayItemSpecific[];
  storeCategoryName?: string | null;
  title?: string | null;
}

const FACET_NAMESPACE = "syncbay_facets";

const FACETS = [
  {
    aliases: ["categoria", "category", "tipologia", "tipo"],
    key: "categoria",
    label: "Categoria",
  },
  {
    aliases: [
      "area stato",
      "area",
      "stato",
      "paese",
      "paese regione",
      "paese di origine",
      "paese di fabbricazione",
      "regione",
    ],
    key: "area_stato",
    label: "Area / Stato",
  },
  {
    aliases: ["materiale", "metallo", "composizione"],
    key: "materiale",
    label: "Materiale",
  },
  {
    aliases: [
      "conservazione",
      "grado",
      "grado di conservazione",
      "stato di conservazione",
    ],
    key: "conservazione",
    label: "Conservazione",
  },
  {
    aliases: [
      "perizia",
      "certificazione",
      "certificato",
      "autenticazione",
      "grading",
    ],
    key: "perizia",
    label: "Perizia",
  },
] as const;

export function buildSyncBayProductFacets(
  input: SyncBayProductFacetInput,
): SyncBayProductFacet[] {
  return FACETS.flatMap((facet) => {
    const values = getFacetValues(facet.key, input, facet.aliases);
    const normalizedValues =
      facet.key === "perizia" ? normalizePeriziaValues(values) : values;
    const productFacet = buildFacet({
      key: facet.key,
      label: facet.label,
      values: normalizedValues,
    });

    return productFacet ? [productFacet] : [];
  });
}

export function buildShopifyProductFacetMetafields(
  facets: SyncBayProductFacet[],
): ShopifyProductFacetMetafield[] {
  return facets.map((facet) => ({
    key: facet.key,
    namespace: facet.namespace,
    type: facet.type,
    value: facet.value,
  }));
}

export function parseEbayTradingItemSpecifics(
  value: unknown,
): EbayItemSpecific[] {
  const record = getObject(value);
  const entries = asArray(record?.NameValueList);

  return entries.flatMap((entry) => {
    const entryRecord = getObject(entry);
    const name = normalizeFacetValue(toText(entryRecord?.Name));
    if (!name) return [];

    const values = dedupe(
      asArray(entryRecord?.Value).flatMap((rawValue) => {
        const normalized = normalizeFacetValue(toText(rawValue));
        return normalized ? [normalized] : [];
      }),
    );
    if (values.length === 0) return [];

    return [{ name, values }];
  });
}

function getFacetValues(
  key: SyncBayProductFacetKey,
  input: SyncBayProductFacetInput,
  aliases: readonly string[],
) {
  const specificValues = getSpecificValues(input.itemSpecifics ?? [], aliases);
  const titleValues = getTitleFacetValues(key, input.title);
  if (
    key === "area_stato" &&
    titleValues.length > 0 &&
    shouldPreferTitleArea(specificValues, titleValues)
  ) {
    return titleValues;
  }
  if (specificValues.length > 0) return specificValues;

  if (key === "categoria") {
    const fallbackValue =
      normalizeFacetValue(input.storeCategoryName) ??
      normalizeFacetValue(input.ebayPrimaryCategoryName) ??
      titleValues[0];
    return fallbackValue ? [fallbackValue] : [];
  }

  return titleValues;
}

function getSpecificValues(
  itemSpecifics: EbayItemSpecific[],
  aliases: readonly string[],
) {
  const normalizedAliases = new Set(aliases.map(normalizeLookupKey));

  return itemSpecifics.flatMap((specific) => {
    if (!normalizedAliases.has(normalizeLookupKey(specific.name))) return [];

    return specific.values.flatMap((value) => {
      const normalized = normalizeFacetValue(value);
      return normalized ? [normalized] : [];
    });
  });
}

function buildFacet(input: {
  key: SyncBayProductFacetKey;
  label: string;
  values: string[];
}): SyncBayProductFacet | null {
  const values = dedupe(input.values);
  if (values.length === 0) return null;

  return {
    key: input.key,
    label: input.label,
    namespace: FACET_NAMESPACE,
    type:
      values.length === 1
        ? "single_line_text_field"
        : "list.single_line_text_field",
    value: values.length === 1 ? values[0]! : JSON.stringify(values),
  };
}

function getTitleFacetValues(
  key: SyncBayProductFacetKey,
  title?: string | null,
) {
  if (!title) return [];

  if (key === "categoria") return getTitleCategoryValues(title);
  if (key === "area_stato") return getTitleAreaValues(title);
  if (key === "materiale") return getTitleMaterialValues(title);
  if (key === "conservazione") return getTitleConservationValues(title);
  if (key === "perizia") return getTitlePeriziaValues(title);

  return [];
}

function getTitleCategoryValues(title: string) {
  const normalized = normalizeLookupKey(title);
  if (hasAnyToken(normalized, ["medaglia", "medaglie"])) return ["Medaglie"];
  if (hasAnyToken(normalized, ["banconota", "banconote"])) return ["Banconote"];
  if (hasAnyToken(normalized, ["francobollo", "francobolli"])) {
    return ["Francobolli"];
  }
  if (hasAnyPhrase(normalized, ["divisionale", "serie zecca", "proof set"])) {
    return ["Divisionali e serie"];
  }
  if (hasAnyToken(normalized, ["moneta", "monete", "lire", "euro"])) {
    return ["Monete"];
  }

  return [];
}

function getTitleAreaValues(title: string) {
  const normalized = normalizeLookupKey(title);
  if (hasAnyPhrase(normalized, ["stato pontificio", "papa pio ix"])) {
    return ["Stato Pontificio"];
  }
  if (
    hasAnyPhrase(normalized, [
      "citta vaticano",
      "vaticano",
      "papa francesco",
      "giovanni xxiii",
      "paolo vi",
    ])
  ) {
    return ["Vaticano"];
  }
  if (hasAnyPhrase(normalized, ["san marino"])) return ["San Marino"];
  if (hasAnyPhrase(normalized, ["germania", "deutschland"])) return ["Germania"];
  if (hasAnyPhrase(normalized, ["regno unito", "u k", "uk"])) {
    return ["Regno Unito"];
  }
  if (hasAnyPhrase(normalized, ["francia"])) return ["Francia"];
  if (hasAnyPhrase(normalized, ["stati uniti", "usa", "u s a"])) {
    return ["Stati Uniti"];
  }
  if (
    hasAnyPhrase(normalized, [
      "italia repubblica",
      "repubblica italiana",
      "repubblica",
    ])
  ) {
    return ["Italia - Repubblica"];
  }
  if (
    hasAnyPhrase(normalized, [
      "italia regno",
      "regno d italia",
      "umberto i",
      "vittorio emanuele",
      "colonia eritrea",
    ])
  ) {
    return ["Italia - Regno"];
  }
  if (hasAnyPhrase(normalized, ["italia"])) return ["Italia"];

  return [];
}

function getTitleMaterialValues(title: string) {
  const normalized = normalizeTitleForTokenMatch(title);
  const materials = [
    ["Argento", /\bARGENTO\b/],
    ["Bronzo", /\bBRONZO\b/],
    ["Oro", /\bORO\b/],
    ["Rame", /\bRAME\b/],
    ["Ottone", /\bOTTONE\b/],
    ["Acmonital", /\bACMONITAL\b/],
    ["Cupronichel", /\bCUPRONICHEL\b/],
    ["Nichel", /\bNICHEL\b/],
  ] as const;

  return materials.flatMap(([value, pattern]) =>
    pattern.test(normalized) ? [value] : [],
  );
}

function getTitleConservationValues(title: string) {
  const normalized = normalizeTitleForTokenMatch(title)
    .replace(/\bQ[\s.]*FDC\b/g, "QFDC")
    .replace(/\bQ[\s.]*SPL\b/g, "QSPL")
    .replace(/\bQ[\s.]*BB\b/g, "QBB");
  const matches = Array.from(
    normalized.matchAll(/(^|[^A-Z0-9])(QFDC|FDC|QSPL|SPL|QBB|BB|MB|PROOF)(?=$|[^A-Z0-9])/g),
  );

  return dedupe(
    matches.map((match) => {
      const token = match[2];
      if (token === "QFDC") return "qFDC";
      if (token === "QSPL") return "qSPL";
      if (token === "QBB") return "qBB";
      if (token === "PROOF") return "Proof";

      return token;
    }),
  );
}

function getTitlePeriziaValues(title: string) {
  const normalized = normalizeLookupKey(title);
  if (
    hasAnyPhrase(normalized, [
      "senza perizia",
      "non periziata",
      "non periziato",
      "non certificata",
      "non certificato",
    ])
  ) {
    return ["Senza perizia"];
  }
  if (
    hasAnyPhrase(normalized, [
      "perizia",
      "periziata",
      "periziato",
      "certificata",
      "certificato",
      "cartellino",
    ])
  ) {
    return ["Con perizia"];
  }

  return [];
}

function shouldPreferTitleArea(specificValues: string[], titleValues: string[]) {
  return (
    specificValues.length === 0 ||
    (specificValues.length === 1 &&
      normalizeLookupKey(specificValues[0]!) === "italia" &&
      normalizeLookupKey(titleValues[0]!) !== "italia")
  );
}

function normalizePeriziaValues(values: string[]) {
  return values.flatMap((value) => {
    const normalized = normalizeLookupKey(value);
    if (
      [
        "si",
        "yes",
        "true",
        "con perizia",
        "certificata",
        "certificato",
        "autenticata",
        "autenticato",
      ].includes(normalized)
    ) {
      return ["Con perizia"];
    }
    if (
      [
        "no",
        "false",
        "senza perizia",
        "non certificata",
        "non certificato",
        "non autenticata",
        "non autenticato",
      ].includes(normalized)
    ) {
      return ["Senza perizia"];
    }

    return value;
  });
}

function normalizeFacetValue(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTitleForTokenMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function hasAnyToken(value: string, tokens: string[]) {
  const words = new Set(value.split(" "));
  return tokens.some((token) => words.has(token));
}

function hasAnyPhrase(value: string, phrases: string[]) {
  return phrases.some((phrase) => value.includes(phrase));
}

function dedupe(values: string[]) {
  return [
    ...new Set(values.map(normalizeFacetValue).filter(isNonEmptyString)),
  ];
}

function isNonEmptyString(value: string | null): value is string {
  return Boolean(value);
}

function asArray(value: unknown) {
  return Array.isArray(value)
    ? value
    : typeof value === "undefined"
      ? []
      : [value];
}

function getObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function toText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!value || typeof value !== "object") return null;

  return toText((value as Record<string, unknown>)["#text"]);
}
