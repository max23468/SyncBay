export type CatalogImportExecutionResult =
  | {
      status: "succeeded";
      summary: Record<string, unknown>;
      warnings: string[];
    }
  | {
      status: "blocked" | "failed";
      errorCode: string;
      errorMessage: string;
      summary: Record<string, unknown>;
      warnings: string[];
    };

export function buildCatalogImportExecutionResult(input: {
  errorCode?: string;
  errorMessage?: string;
  status: CatalogImportExecutionResult["status"];
  summary?: Record<string, unknown>;
  warnings?: string[];
}): CatalogImportExecutionResult {
  const summary = input.summary ?? {};
  const warnings = [...new Set(input.warnings ?? [])];

  if (input.status === "succeeded") {
    return { status: input.status, summary, warnings };
  }

  return {
    errorCode: input.errorCode ?? "CATALOG_IMPORT_FAILED",
    errorMessage: input.errorMessage ?? "Import catalogo non completato.",
    status: input.status,
    summary,
    warnings,
  };
}
