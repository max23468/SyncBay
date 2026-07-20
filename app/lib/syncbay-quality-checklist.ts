export type ImportQualitySeverity = "critical" | "info" | "warning";
export type ImportQualityStatus = "fail" | "pass" | "warning";

export interface ImportQualityChecklistItem {
  code:
    | "category_weak"
    | "description_cleaned"
    | "images_missing"
    | "price_invalid"
    | "quantity_unknown"
    | "sku_present"
    | "sku_generated"
    | "sku_missing"
    | "variants_complex";
  label: string;
  severity: ImportQualitySeverity;
  status: ImportQualityStatus;
}

export function buildImportQualityChecklist(input: {
  categoryConfidence?: string | null;
  descriptionWasChanged: boolean;
  imageCount: number;
  priceAmount: number | null;
  quantity: number | null;
  sku: string | null;
  skuGenerated: boolean;
  variantCount?: number | null;
}): ImportQualityChecklistItem[] {
  const items: ImportQualityChecklistItem[] = [];

  items.push(
    input.sku
      ? {
          code: input.skuGenerated ? "sku_generated" : "sku_present",
          label: input.skuGenerated ? "SKU generato da ItemID eBay" : "SKU presente",
          severity: input.skuGenerated ? "info" : "info",
          status: "pass",
        }
      : {
          code: "sku_missing",
          label: "SKU mancante",
          severity: "critical",
          status: "fail",
        },
  );
  items.push(
    typeof input.priceAmount === "number" && input.priceAmount > 0
      ? {
          code: "price_invalid",
          label: "Prezzo valido",
          severity: "info",
          status: "pass",
        }
      : {
          code: "price_invalid",
          label: "Prezzo assente o non valido",
          severity: "critical",
          status: "fail",
        },
  );
  items.push(
    Number.isInteger(input.quantity) && Number(input.quantity) >= 0
      ? {
          code: "quantity_unknown",
          label: "Disponibilità leggibile",
          severity: "info",
          status: "pass",
        }
      : {
          code: "quantity_unknown",
          label: "Disponibilità non leggibile",
          severity: "critical",
          status: "fail",
        },
  );
  items.push(
    input.imageCount > 0
      ? {
          code: "images_missing",
          label: "Immagini presenti",
          severity: "info",
          status: "pass",
        }
      : {
          code: "images_missing",
          label: "Immagini mancanti",
          severity: "warning",
          status: "warning",
        },
  );
  items.push(
    (input.variantCount ?? 1) <= 1
      ? {
          code: "variants_complex",
          label: "Varianti semplici",
          severity: "info",
          status: "pass",
        }
      : {
          code: "variants_complex",
          label: "Varianti troppo complesse",
          severity: "critical",
          status: "fail",
        },
  );
  items.push(
    input.categoryConfidence === "low"
      ? {
          code: "category_weak",
          label: "Categoria Shopify incerta",
          severity: "warning",
          status: "warning",
        }
      : {
          code: "category_weak",
          label: "Categoria utilizzabile",
          severity: "info",
          status: "pass",
        },
  );
  items.push({
    code: "description_cleaned",
    label: input.descriptionWasChanged
      ? "Descrizione ripulita"
      : "Descrizione senza pulizia rilevante",
    severity: "info",
    status: "pass",
  });

  return items;
}

export function getQualityChecklistSummary(checklist: ImportQualityChecklistItem[]) {
  const failures = checklist.filter((item) => item.status === "fail").length;
  const warnings = checklist.filter((item) => item.status === "warning").length;

  if (failures > 0) return `${failures} blocchi, ${warnings} avvisi`;
  if (warnings > 0) return `${warnings} avvisi`;

  return `${checklist.length} controlli ok`;
}
