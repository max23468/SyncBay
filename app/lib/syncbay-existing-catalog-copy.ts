import type { ExistingCatalogFieldPolicy } from "./syncbay-existing-catalog-field-policy";
import type {
  ExistingCatalogPlannedOperation,
  ExistingCatalogTakeoverReason,
  ExistingCatalogTakeoverStatus,
} from "./syncbay-existing-catalog-takeover";

export function formatExistingCatalogTakeoverStatus(
  value: ExistingCatalogTakeoverStatus,
) {
  const labels: Record<ExistingCatalogTakeoverStatus, string> = {
    applicabile: "applicabile",
    bloccante: "bloccante",
    da_rivedere: "da rivedere",
    gia_collegato: "già collegato",
  };
  return labels[value];
}

export function formatExistingCatalogOperation(
  value: ExistingCatalogPlannedOperation,
) {
  const labels: Record<ExistingCatalogPlannedOperation, string> = {
    add_syncbay_tag: "aggiungere tag SyncBay",
    claim_mapping: "creare mapping",
    preserve_handle: "preservare handle",
    sync_category: "allineare categoria",
    sync_description: "ripulire descrizione",
    sync_facets: "allineare faccette",
    sync_price: "allineare prezzo",
    sync_quantity: "allineare disponibilità",
    sync_seo: "allineare SEO",
    sync_title: "allineare titolo",
  };
  return labels[value];
}

export function formatExistingCatalogFieldPolicy(
  policy: ExistingCatalogFieldPolicy,
) {
  return [
    policy.handle.currentHandle
      ? `URL preservato: ${policy.handle.currentHandle}`
      : "URL Shopify preservato se presente",
    policy.images.operation === "preserve"
      ? "Immagini Shopify esistenti preservate"
      : "Immagini eBay aggiunte solo se il prodotto Shopify non ha immagini",
    policy.tags.add.length > 0
      ? `Tag aggiunti: ${policy.tags.add.join(", ")}`
      : "Nessun tag SyncBay da aggiungere",
    policy.tags.remove.length > 0
      ? `Tag legacy rimossi: ${policy.tags.remove.join(", ")}`
      : "Nessun tag legacy rimosso automaticamente",
  ];
}

export function formatExistingCatalogReason(
  value: ExistingCatalogTakeoverReason,
) {
  const labels: Record<ExistingCatalogTakeoverReason, string> = {
    categoria_incerta: "categoria incerta",
    disponibilita_ebay_non_valida: "disponibilità eBay non valida",
    immagini_mancanti: "immagini mancanti",
    match_ambiguo: "match ambiguo",
    match_non_automatico: "match non automatico",
    match_shopify_mancante: "match Shopify mancante",
    prezzo_ebay_non_valido: "prezzo eBay non valido",
    varianti_non_supportate: "varianti non supportate",
  };
  return labels[value];
}
