export function getImportRunScopeId(job) {
  const runId = job?.payload?.catalogImportRunId;

  if (typeof runId === "string" && runId.trim()) return runId;

  return job?.id ?? null;
}

export function buildImportRunScopeSql(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Alias SQL non valido: ${alias}`);
  }

  return `coalesce(nullif(${alias}.payload->>'catalogImportRunId', ''), ${alias}.id)`;
}
