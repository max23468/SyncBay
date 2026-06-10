-- Aggiunge lo stato OUT_OF_STOCK al mapping prodotto: un listing eBay inattivo
-- mantiene il prodotto Shopify come esaurito (scorta 0, politica DENY) invece di
-- archiviarlo, per preservarne l'indicizzazione SEO. Vedi ADR 0011.
ALTER TYPE "ProductMappingStatus" ADD VALUE IF NOT EXISTS 'OUT_OF_STOCK' AFTER 'ARCHIVED';
