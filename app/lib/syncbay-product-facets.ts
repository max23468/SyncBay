export type SyncBayProductFacetKey =
  | "categoria"
  | "area_stato"
  | "materiale"
  | "conservazione"
  | "perizia";

export type SyncBayProductFacetConfidence = "high" | "medium" | "low";

export type SyncBayProductFacetSource =
  | "title_rule"
  | "category_hint"
  | "ebay_specific";

export interface EbayItemSpecific {
  name: string;
  values: string[];
}

export interface SyncBayProductFacet extends ShopifyProductFacetMetafield {
  label: string;
}

export interface SyncBayProductFacetInference extends SyncBayProductFacet {
  confidence: SyncBayProductFacetConfidence;
  evidence: string[];
  ruleId: string;
  source: SyncBayProductFacetSource;
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
const FACET_TYPES: Record<
  SyncBayProductFacetKey,
  SyncBayProductFacet["type"]
> = {
  area_stato: "single_line_text_field",
  categoria: "single_line_text_field",
  conservazione: "list.single_line_text_field",
  materiale: "list.single_line_text_field",
  perizia: "single_line_text_field",
};

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
  return buildSyncBayProductFacetInferences(input).flatMap((inference) =>
    inference.confidence === "high"
      ? [
          {
            key: inference.key,
            label: inference.label,
            namespace: inference.namespace,
            type: inference.type,
            value: inference.value,
          },
        ]
      : [],
  );
}

export function buildSyncBayProductFacetInferences(
  input: SyncBayProductFacetInput,
): SyncBayProductFacetInference[] {
  return FACETS.flatMap((facet) => {
    const inference = getFacetInference(facet.key, input, facet.aliases);
    if (!inference) return [];

    const normalizedValues =
      facet.key === "perizia"
        ? normalizePeriziaValues(inference.values)
        : inference.values;
    const productFacet = buildFacet({
      key: facet.key,
      label: facet.label,
      values: normalizedValues,
    });
    if (!productFacet) return [];

    return [
      {
        ...productFacet,
        confidence: inference.confidence,
        evidence: inference.evidence,
        ruleId: inference.ruleId,
        source: inference.source,
      },
    ];
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

function getFacetInference(
  key: SyncBayProductFacetKey,
  input: SyncBayProductFacetInput,
  aliases: readonly string[],
):
  | {
      confidence: SyncBayProductFacetConfidence;
      evidence: string[];
      ruleId: string;
      source: SyncBayProductFacetSource;
      values: string[];
    }
  | null {
  const titleValues = getTitleFacetValues(key, input.title);
  if (titleValues.length > 0) {
    return {
      confidence: "high",
      evidence: [input.title ?? ""].filter(Boolean),
      ruleId: `title:${key}`,
      source: "title_rule",
      values: titleValues,
    };
  }

  if (key === "categoria") {
    const storefrontCategory = getStorefrontCategoryValue(
      input.storeCategoryName,
    );
    if (storefrontCategory) {
      return {
        confidence: "high",
        evidence: [input.storeCategoryName ?? ""].filter(Boolean),
        ruleId: "category_hint:store",
        source: "category_hint",
        values: [storefrontCategory],
      };
    }

    const marketplaceCategory = getStorefrontCategoryValue(
      input.ebayPrimaryCategoryName,
    );
    if (marketplaceCategory) {
      return {
        confidence: "medium",
        evidence: [input.ebayPrimaryCategoryName ?? ""].filter(Boolean),
        ruleId: "category_hint:marketplace",
        source: "category_hint",
        values: [marketplaceCategory],
      };
    }
  }

  const specificValues = getSpecificValues(input.itemSpecifics ?? [], aliases);
  if (specificValues.length > 0) {
    return {
      confidence: "medium",
      evidence: specificValues,
      ruleId: `ebay_specific:${key}`,
      source: "ebay_specific",
      values: specificValues,
    };
  }

  return null;
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
    type: FACET_TYPES[input.key],
    value:
      FACET_TYPES[input.key] === "list.single_line_text_field"
        ? JSON.stringify(values)
        : values[0]!,
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
  if (hasAnyPhrase(normalized, ["altro collezionismo"])) {
    return ["Altro collezionismo"];
  }
  if (hasAnyToken(normalized, ["miniassegno", "miniassegni"])) {
    return ["Miniassegni"];
  }
  if (hasAnyToken(normalized, ["medaglia", "medaglie"])) return ["Medaglie"];
  if (hasAnyToken(normalized, ["banconota", "banconote"])) return ["Banconote"];
  if (hasAnyToken(normalized, ["francobollo", "francobolli"])) {
    return ["Francobolli"];
  }
  if (
    hasAnyToken(normalized, ["catalogo", "cataloghi", "libro", "libri"]) ||
    hasAnyPhrase(normalized, ["accessori numismatici"])
  ) {
    return ["Libri, cataloghi e accessori"];
  }
  if (hasAnyPhrase(normalized, ["divisionale", "serie zecca", "proof set"])) {
    return ["Divisionali e serie"];
  }
  if (
    hasAnyPhrase(normalized, [
      "monete antiche",
      "moneta romana",
      "monete romane",
      "impero romano",
      "repubblica romana",
      "magna grecia",
    ])
  ) {
    return ["Monete antiche"];
  }
  if (hasAnyPhrase(normalized, ["pre euro", "pre-euro"])) {
    return ["Monete europee pre euro"];
  }
  if (hasAnyToken(normalized, ["euro"])) {
    return ["Monete in euro"];
  }
  if (
    hasAnyToken(normalized, [
      "lira",
      "lire",
      "centesimo",
      "centesimi",
      "cent",
    ])
  ) {
    return ["Monete italiane in lire"];
  }
  if (hasAnyToken(normalized, ["moneta", "monete", "lire", "euro"])) {
    return ["Monete"];
  }

  return [];
}

function getStorefrontCategoryValue(value?: string | null) {
  const normalized = normalizeLookupKey(value ?? "");
  if (!normalized) return null;

  if (hasAnyPhrase(normalized, ["altro collezionismo"])) {
    return "Altro collezionismo";
  }
  if (hasAnyToken(normalized, ["miniassegno", "miniassegni"])) {
    return "Miniassegni";
  }
  if (hasAnyPhrase(normalized, ["libri cataloghi accessori"])) {
    return "Libri, cataloghi e accessori";
  }
  if (hasAnyPhrase(normalized, ["divisionali", "divisionale", "serie zecca"])) {
    return "Divisionali e serie";
  }
  if (hasAnyPhrase(normalized, ["monete italiane in lire"])) {
    return "Monete italiane in lire";
  }
  if (hasAnyPhrase(normalized, ["monete in euro"])) {
    return "Monete in euro";
  }
  if (hasAnyPhrase(normalized, ["monete europee pre euro"])) {
    return "Monete europee pre euro";
  }
  if (hasAnyPhrase(normalized, ["monete antiche"])) {
    return "Monete antiche";
  }
  if (hasAnyToken(normalized, ["francobollo", "francobolli"])) {
    return "Francobolli";
  }
  if (hasAnyToken(normalized, ["banconota", "banconote"])) {
    return "Banconote";
  }
  if (hasAnyToken(normalized, ["medaglia", "medaglie"])) {
    return "Medaglie";
  }

  const normalizedValue = normalizeFacetValue(value);
  if (normalizedValue && !normalizedValue.includes(":")) return normalizedValue;

  return null;
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
  if (
    hasAnyPhrase(normalized, ["regno unito", "u k"]) ||
    hasAnyToken(normalized, ["uk"])
  ) {
    return ["Regno Unito"];
  }
  if (hasAnyPhrase(normalized, ["francia"])) return ["Francia"];
  if (
    hasAnyPhrase(normalized, ["stati uniti", "u s a"]) ||
    hasAnyToken(normalized, ["usa"])
  ) {
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
