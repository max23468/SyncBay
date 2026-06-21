export type ImportPreviewLoadMode = "deferred" | "live";

export function normalizeImportPreviewLoadMode(
  value: FormDataEntryValue | string | null | undefined,
): ImportPreviewLoadMode {
  return value === "live" ? "live" : "deferred";
}
