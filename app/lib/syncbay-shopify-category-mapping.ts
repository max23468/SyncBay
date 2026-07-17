type ShopifyCategoryProposalConfidence = "high" | "medium" | "low";
type ShopifyCategoryProposalSource =
  "ebay_primary_category" | "ebay_store_category" | "title" | "fallback";

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
  const signals = getProposalSignals({ primaryText, storeText, titleText });

  if (titleText && matchesPrintBooks(titleText)) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.printBooks,
      confidence: "medium",
      productType: "Libri e cataloghi",
      source: "title",
    });
  }

  const banknotesSignal = findMatchingSignal(signals, matchesBanknotes);
  if (banknotesSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleBanknotes,
      confidence: banknotesSignal.confidence,
      productType: "Banconote italiane",
      source: banknotesSignal.source,
    });
  }

  const medalsSignal = findMedalsSignal(signals, {
    primaryText,
    storeText,
  });
  if (medalsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoinsAndCurrency,
      confidence: medalsSignal.confidence,
      productType: "Medaglie",
      source: medalsSignal.source,
    });
  }

  const firstDayCoversSignal = findFirstDayCoversSignal(signals);
  if (firstDayCoversSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.firstDayCovers,
      confidence: firstDayCoversSignal.confidence,
      productType: "Buste primo giorno",
      source: firstDayCoversSignal.source,
    });
  }

  const stampSheetsSignal = findMatchingSignal(signals, matchesStampSheets);
  if (stampSheetsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.stampSheets,
      confidence: stampSheetsSignal.confidence,
      productType: "Fogli francobolli",
      source: stampSheetsSignal.source,
    });
  }

  const stampsSignal = findMatchingSignal(signals, matchesStamps);
  if (stampsSignal) {
    const singleStampSignal = findMatchingSignal(signals, matchesSingleStamp);

    return buildProposal({
      category: singleStampSignal
        ? SHOPIFY_TAXONOMY_CATEGORIES.singleStamps
        : SHOPIFY_TAXONOMY_CATEGORIES.postageStamps,
      confidence: singleStampSignal?.confidence ?? stampsSignal.confidence,
      productType: "Francobolli",
      source: singleStampSignal?.source ?? stampsSignal.source,
    });
  }

  const bullionCoinsSignal = findMatchingSignal(signals, matchesBullionCoins);
  if (bullionCoinsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
      confidence: bullionCoinsSignal.confidence,
      productType: "Monete bullion",
      source: bullionCoinsSignal.source,
    });
  }

  const collectionGradeCoinType = getCollectionGradeCoinProductType({
    primaryText,
    storeText,
    titleText,
  });

  const commemorativeCoinsSignal = findMatchingSignal(
    signals,
    matchesCommemorativeCoins,
  );
  const rareCoinsSignal = findMatchingSignal(signals, matchesRareCoins);
  const coinsSignal = findMatchingSignal(signals, matchesCoins);
  const collectionGradeCoinSignal =
    rareCoinsSignal ?? coinsSignal ?? commemorativeCoinsSignal;

  if (collectionGradeCoinType && collectionGradeCoinSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
      confidence: collectionGradeCoinSignal.confidence,
      productType: collectionGradeCoinType,
      source: collectionGradeCoinSignal.source,
    });
  }

  if (commemorativeCoinsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
      confidence: commemorativeCoinsSignal.confidence,
      productType: "Monete commemorative",
      source: commemorativeCoinsSignal.source,
    });
  }

  if (rareCoinsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
      confidence: rareCoinsSignal.confidence,
      productType: "Monete italiane",
      source: rareCoinsSignal.source,
    });
  }

  if (coinsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
      confidence: coinsSignal.confidence,
      productType: "Monete italiane",
      source: coinsSignal.source,
    });
  }

  const numismaticsSignal = findMatchingSignal(signals, matchesNumismatics);
  if (numismaticsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoinsAndCurrency,
      confidence: numismaticsSignal.confidence,
      productType: "Collezionismo numismatico",
      source: numismaticsSignal.source,
    });
  }

  const scaleModelCarsSignal = findMatchingSignal(
    signals,
    matchesScaleModelCars,
  );
  if (scaleModelCarsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.scaleModelsCars,
      confidence: scaleModelCarsSignal.confidence,
      productType: "Modellini auto",
      source: scaleModelCarsSignal.source,
    });
  }

  const musicRecordsSignal = findMatchingSignal(signals, matchesMusicRecords);
  if (musicRecordsSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.musicRecords,
      confidence: musicRecordsSignal.confidence,
      productType: "Dischi musicali",
      source: musicRecordsSignal.source,
    });
  }

  const typewritersSignal = findMatchingSignal(signals, matchesTypewriters);
  if (typewritersSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.typewriters,
      confidence: typewritersSignal.confidence,
      productType: "Macchine da scrivere",
      source: typewritersSignal.source,
    });
  }

  const printBooksSignal = findMatchingSignal(signals, matchesPrintBooks);
  if (printBooksSignal) {
    return buildProposal({
      category: SHOPIFY_TAXONOMY_CATEGORIES.printBooks,
      confidence: printBooksSignal.confidence,
      productType: "Libri e cataloghi",
      source: printBooksSignal.source,
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

function getProposalSignals(input: {
  primaryText: string;
  storeText: string;
  titleText: string;
}) {
  return [
    {
      confidence: "high",
      source: "ebay_primary_category",
      text: input.primaryText,
    },
    {
      confidence: "medium",
      source: "ebay_store_category",
      text: input.storeText,
    },
    {
      confidence: "medium",
      source: "title",
      text: input.titleText,
    },
  ] satisfies Array<{
    confidence: ShopifyCategoryProposalConfidence;
    source: ShopifyCategoryProposalSource;
    text: string;
  }>;
}

function findMatchingSignal(
  signals: ReturnType<typeof getProposalSignals>,
  matcher: (value: string) => boolean,
) {
  return signals.find((signal) => signal.text && matcher(signal.text)) ?? null;
}

function findMedalsSignal(
  signals: ReturnType<typeof getProposalSignals>,
  context: { primaryText: string; storeText: string },
) {
  const nonTitleSignal = findMatchingSignal(
    signals.filter((signal) => signal.source !== "title"),
    matchesMedals,
  );
  if (nonTitleSignal) return nonTitleSignal;

  const titleSignal = findMatchingSignal(
    signals.filter((signal) => signal.source === "title"),
    matchesMedals,
  );
  if (!titleSignal) return null;

  if (!context.primaryText && !context.storeText) return titleSignal;
  if (isGenericNumismaticContext(context.primaryText, context.storeText)) {
    return titleSignal;
  }

  return null;
}

function findFirstDayCoversSignal(
  signals: ReturnType<typeof getProposalSignals>,
) {
  const explicitSignal = findMatchingSignal(signals, matchesFirstDayCovers);
  if (explicitSignal) return explicitSignal;

  const fdcSignal = findMatchingSignal(signals, (value) =>
    hasToken(value, "fdc"),
  );
  const stampsSignal = findMatchingSignal(signals, matchesStamps);

  return fdcSignal && stampsSignal ? fdcSignal : null;
}

function matchesBanknotes(value: string) {
  const withoutMacroCategory = value.replaceAll("monete e banconote", "");

  return hasAny(withoutMacroCategory, ["banconot", "banknote", "paper money"]);
}

function matchesFirstDayCovers(value: string) {
  const hasExplicitFirstDayCoverSignal = hasAny(value, [
    "buste primo giorno",
    "busta primo giorno",
  ]);
  const hasFdcStampSignal = hasToken(value, "fdc") && matchesStamps(value);

  return hasExplicitFirstDayCoverSignal || hasFdcStampSignal;
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

function getCollectionGradeCoinProductType(input: {
  primaryText: string;
  storeText: string;
  titleText: string;
}): string | null {
  const text = [input.primaryText, input.storeText, input.titleText].join(" ");

  if (text.includes("monete italiane in lire") && text.includes("regno")) {
    return "Monete italiane in lire:Regno";
  }
  if (text.includes("monete italiane in lire") && text.includes("repubblica")) {
    return "Monete italiane in lire:Repubblica";
  }
  if (text.includes("monete in euro") && text.includes("italia")) {
    return "Monete in euro:Italia";
  }
  if (text.includes("monete in euro") && text.includes("vaticano")) {
    return "Monete in euro:Vaticano";
  }
  if (text.includes("monete in euro") && text.includes("san marino")) {
    return "Monete in euro:San Marino";
  }
  if (text.includes("monete europee pre euro") && text.includes("francia")) {
    return "Monete europee pre euro:Francia";
  }
  if (text.includes("monete europee pre euro")) {
    return "Monete europee pre euro";
  }

  return null;
}

function matchesCommemorativeCoins(value: string) {
  return hasAny(value, ["commemorativ", "commemorative"]);
}

function matchesMedals(value: string) {
  return hasAny(value, ["medagli", "medal"]);
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

function isGenericNumismaticContext(primaryText: string, storeText: string) {
  const context = `${primaryText} ${storeText}`.trim();
  if (!context) return true;

  return matchesNumismatics(context) || matchesCoins(context);
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
  // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- `value` è una stringa: qui `includes` è String.prototype.includes (ricerca di sottostringa), non Array.includes; un Set non è applicabile.
  return needles.some((needle) => value.includes(needle));
}

function hasToken(value: string, token: string) {
  return value.split(" ").includes(token);
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
