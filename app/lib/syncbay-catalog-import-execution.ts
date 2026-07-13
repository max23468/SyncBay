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

export interface CatalogImportOwnerJob {
  id: string;
}

export interface CatalogImportExecutionInput {
  jobId: string;
}

export interface CatalogImportJobLifecyclePorts<
  TJob extends CatalogImportOwnerJob,
  TExecutionInput extends CatalogImportExecutionInput,
> {
  execute: (
    input: TExecutionInput,
  ) => Promise<CatalogImportExecutionResult>;
  markFailed: (input: {
    errorCode: string;
    errorMessage: string;
    job: TJob;
    result: Record<string, unknown>;
  }) => Promise<void>;
  markSucceeded: (input: {
    job: TJob;
    result: Record<string, unknown>;
    warnings: string[];
  }) => Promise<void>;
}

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

export async function runCatalogImportJobLifecycle<
  TJob extends CatalogImportOwnerJob,
  TExecutionInput extends CatalogImportExecutionInput,
>(input: {
  executionInput: TExecutionInput;
  job: TJob;
  ports: CatalogImportJobLifecyclePorts<TJob, TExecutionInput>;
}): Promise<CatalogImportExecutionResult> {
  if (input.executionInput.jobId !== input.job.id) {
    throw new Error(
      "L'import catalogo deve usare l'ID del job esterno proprietario.",
    );
  }

  const result = await input.ports.execute(input.executionInput);

  if (result.status === "succeeded") {
    await input.ports.markSucceeded({
      job: input.job,
      result: result.summary,
      warnings: result.warnings,
    });
    return result;
  }

  await input.ports.markFailed({
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    job: input.job,
    result: {
      ...result.summary,
      warnings: result.warnings,
    },
  });
  return result;
}
