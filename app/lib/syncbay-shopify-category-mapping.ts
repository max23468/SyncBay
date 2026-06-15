export type ShopifyCategoryProposalConfidence = "high" | "medium" | "low";
export type ShopifyCategoryProposalSource =
  | "ebay_primary_category"
  | "ebay_store_category"
  | "title"
  | "fallback";

export interface ShopifyCategoryProposalInput {
  ebayPrimaryCategoryName?: string | null;
  ebayPrimaryCategoryPath?: string | null;
  ebayStoreCategoryName?: string | null;
  title?: string | null;
}

export interface ShopifyCategoryProposal {
  applied: false;
  confidence: ShopifyCategoryProposalConfidence;
  productType: string;
  reason: "dry_run_only" | "low_confidence";
  shopifyCategoryGid: string | null;
  shopifyCategoryName: string | null;
  source: ShopifyCategoryProposalSource;
}

const SHOPIFY_TAXONOMY_CATEGORIES = {
  bullionCoins: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-1",
    name: "Bullion Coins",
  },
  collectibleBanknotes: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-2-1",
    name: "Collectible Banknotes",
  },
  collectibleCoins: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
    name: "Collectible Coins",
  },
  collectibleCoinsAndCurrency: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-2",
    name: "Collectible Coins & Currency",
  },
  commemorativeCoins: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-2",
    name: "Commemorative Coins",
  },
  firstDayCovers: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-5-3",
    name: "First Day Covers",
  },
  musicRecords: {
    gid: "gid://shopify/TaxonomyCategory/me-3-4",
    name: "Records & LPs",
  },
  printBooks: {
    gid: "gid://shopify/TaxonomyCategory/me-1-3",
    name: "Print Books",
  },
  postageStamps: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-5",
    name: "Postage Stamps",
  },
  rareCoins: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
    name: "Rare Coins",
  },
  scaleModelsCars: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-8-3",
    name: "Cars",
  },
  singleStamps: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-5-4",
    name: "Single Stamps",
  },
  stampSheets: {
    gid: "gid://shopify/TaxonomyCategory/ae-2-2-5-6",
    name: "Stamp Sheets",
  },
  typewriters: {
    gid: "gid://shopify/TaxonomyCategory/os-10-10",
    name: "Typewriters",
  },
} as const;

export function resolveShopifyCategoryProposal(
  input: ShopifyCategoryProposalInput,
): ShopifyCategoryProposal {
  const primaryText = normalizeSearchText(
    [input.ebayPrimaryCategoryPath, input.ebayPrimaryCategoryName].join(" "),
  );
  const storeText = normalizeSearchText(input.ebayStoreCategoryName);
  const titleText = normalizeSearchText(input.title);
  const combinedText = [primaryText, storeText, titleText].join(" ");
  const source = getProposalSource({ primaryText, storeText, titleText });
  const confidence = source === "ebay_primary_category" ? "high" : "medium";

  if (matchesBanknotes(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleBanknotes,
      confidence,
      productType: "Banconote italiane",
      source,
    });
  }

  if (matchesFirstDayCovers(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.firstDayCovers,
      confidence,
      productType: "Buste primo giorno",
      source,
    });
  }

  if (matchesStampSheets(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.stampSheets,
      confidence,
      productType: "Fogli francobolli",
      source,
    });
  }

  if (matchesStamps(combinedText)) {
    return buildProposal({
      category: matchesSingleStamp(combinedText)
        ? SHOPIFY_TAXONOMY_CATEGORIES.singleStamps
        : SHOPIFY_TAXONOMY_CATEGORIES.postageStamps,
      confidence,
      productType: "Francobolli",
      source,
    });
  }

  if (matchesBullionCoins(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.bullionCoins,
      confidence,
      productType: "Monete bullion",
      source,
    });
  }

  if (matchesCommemorativeCoins(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.commemorativeCoins,
      confidence,
      productType: "Monete commemorative",
      source,
    });
  }

  if (matchesRareCoins(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.rareCoins,
      confidence,
      productType: "Monete italiane",
      source,
    });
  }

  if (matchesCoins(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
      confidence,
      productType: "Monete italiane",
      source,
    });
  }

  if (matchesNumismatics(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoinsAndCurrency,
      confidence,
      productType: "Collezionismo numismatico",
      source,
    });
  }

  if (matchesScaleModelCars(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.scaleModelsCars,
      confidence,
      productType: "Modellini auto",
      source,
    });
  }

  if (matchesMusicRecords(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.musicRecords,
      confidence,
      productType: "Dischi musicali",
      source,
    });
  }

  if (matchesTypewriters(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.typewriters,
      confidence,
      productType: "Macchine da scrivere",
      source,
    });
  }

  if (matchesPrintBooks(combinedText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.printBooks,
      confidence,
      productType: "Libri e cataloghi",
      source,
    });
  }

  return {
    applied: false,
    confidence: "low",
    productType: "Collezionismo",
    reason: "low_confidence",
    shopifyCategoryGid: null,
    shopifyCategoryName: null,
    source: "fallback",
  };
}

function buildProposal(input: {
  category: { gid: string; name: string };
  confidence: ShopifyCategoryProposalConfidence;
  productType: string;
  source: ShopifyCategoryProposalSource;
}): ShopifyCategoryProposal {
  return {
    applied: false,
    confidence: input.confidence,
    productType: input.productType,
    reason: "dry_run_only",
    shopifyCategoryGid: input.category.gid,
    shopifyCategoryName: input.category.name,
    source: input.source,
  };
}

function getProposalSource(input: {
  primaryText: string;
  storeText: string;
  titleText: string;
}): ShopifyCategoryProposalSource {
  if (input.primaryText) return "ebay_primary_category";
  if (input.storeText) return "ebay_store_category";
  if (input.titleText) return "title";

  return "fallback";
}

function matchesBanknotes(value: string) {
  const withoutMacroCategory = value.replaceAll("monete e banconote", "");

  return hasAny(withoutMacroCategory, ["banconot", "banknote", "paper money"]);
}

function matchesFirstDayCovers(value: string) {
  return hasAny(value, ["buste primo giorno", "busta primo giorno", " fdc "]);
}

function matchesStampSheets(value: string) {
  return hasAny(value, [
    "fogli francobolli",
    "foglio francobolli",
    "stamp sheets",
  ]);
}

function matchesStamps(value: string) {
  return hasAny(value, ["francoboll", "filateli", "postage stamp"]);
}

function matchesSingleStamp(value: string) {
  return hasAny(value, ["singol", "single stamp"]);
}

function matchesBullionCoins(value: string) {
  return hasAny(value, [
    "bullion",
    "krugerrand",
    "maple leaf",
    "silver eagle",
    "gold eagle",
    "oncia",
    "1 oz",
  ]);
}

function matchesCommemorativeCoins(value: string) {
  return hasAny(value, ["commemorativ", "commemorative"]);
}

function matchesRareCoins(value: string) {
  return hasAny(value, [
    "regno",
    "repubblica",
    "vaticano",
    "savoia",
    "vittorio emanuele",
    "umberto",
    "zecca",
    "rara",
    "rare",
    "aquilino",
    "marengo",
    "sterlina",
  ]);
}

function matchesCoins(value: string) {
  return hasAny(value, ["monet", "coin"]);
}

function matchesNumismatics(value: string) {
  return hasAny(value, ["numismatic", "monete e banconote"]);
}

function matchesScaleModelCars(value: string) {
  const hasModelSignal = hasAny(value, [
    "modellin",
    "modellino",
    "modellismo",
    "scale model",
    "scala 1 43",
    "scala 1 24",
    "scala 1 18",
  ]);
  const hasCarSignal = hasAny(value, [
    " auto ",
    " car ",
    " automobile",
    "fiat",
    "alfa romeo",
    "lancia",
    "ferrari",
    "maserati",
    "abarth",
  ]);

  return hasModelSignal && hasCarSignal;
}

function matchesMusicRecords(value: string) {
  const hasRecordSignal = hasAny(value, [
    " disco ",
    " dischi ",
    " lp ",
    " 33 giri ",
    " 45 giri ",
    " record ",
    " records ",
  ]);
  const hasMusicSignal = hasAny(value, [
    " opera ",
    " sinfon",
    " orchestra",
    " concert",
    " music",
    "musicisti",
    " musica",
    "album",
    "grand opera",
    "beethoven",
    "bach",
    "ciaikovski",
    "offenbach",
    "frescobaldi",
    "rossini",
    "brahms",
    "smetana",
  ]);

  const hasMaintainerConfirmedSeries = hasAny(value, [
    "fabbri editore i grandi musicisti",
  ]);

  return (hasRecordSignal && hasMusicSignal) || hasMaintainerConfirmedSeries;
}

function matchesTypewriters(value: string) {
  return hasAny(value, ["macchina da scrivere", "typewriter"]);
}

function matchesPrintBooks(value: string) {
  const hasBookSignal = hasAny(value, [" libro ", " catalogo ", " print book"]);
  const hasPhoneCardCatalogSignal = hasAny(value, [
    "carte telefoniche",
    "phone cards",
    "collectible phone cards",
  ]);

  return hasBookSignal && hasPhoneCardCatalogSignal;
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function normalizeSearchText(value: string | null | undefined) {
  return ` ${value ?? ""} `
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
