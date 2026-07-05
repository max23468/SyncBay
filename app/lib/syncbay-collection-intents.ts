import fs from "node:fs";

export interface CollectionRuleIntent {
  generic?: boolean;
  handle: string;
  productTypeContains?: string[];
  requirePositiveInventory: boolean;
  title: string;
}

export function loadCollectionIntents(filePath: string): CollectionRuleIntent[] {
  return parseCollectionIntents(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function parseCollectionIntents(value: unknown): CollectionRuleIntent[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { collectionIntents?: unknown }).collectionIntents)) {
    throw new Error("File intenti non valido: atteso { collectionIntents: [...] }.");
  }

  const rawIntents = (value as { collectionIntents: unknown[] }).collectionIntents;

  const seenHandles = new Set<string>();
  for (const raw of rawIntents) {
    const handle = (raw as Partial<CollectionRuleIntent>).handle;
    if (typeof handle !== "string" || handle.length === 0) continue;
    if (seenHandles.has(handle)) {
      throw new Error(`Handle collezione duplicato: ${handle}`);
    }
    seenHandles.add(handle);
  }

  return rawIntents.map((raw) => {
    const intent = raw as Partial<CollectionRuleIntent>;
    if (!intent.handle || !intent.title || typeof intent.requirePositiveInventory !== "boolean") {
      throw new Error("Intento collezione non valido: handle, title e requirePositiveInventory sono obbligatori.");
    }
    if (!intent.generic && (!Array.isArray(intent.productTypeContains) || intent.productTypeContains.length === 0)) {
      throw new Error(`Intento ${intent.handle} senza productTypeContains: non proporre regole specifiche senza selettore affidabile.`);
    }
    return {
      generic: Boolean(intent.generic),
      handle: intent.handle,
      productTypeContains: intent.productTypeContains,
      requirePositiveInventory: intent.requirePositiveInventory,
      title: intent.title,
    };
  });
}
