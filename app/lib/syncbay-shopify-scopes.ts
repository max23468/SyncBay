export function hasEffectiveShopifyScope(scopes: string[], requiredScope: string) {
  if (scopes.includes(requiredScope)) return true;

  if (requiredScope.startsWith("read_")) {
    return scopes.includes(requiredScope.replace(/^read_/, "write_"));
  }

  return false;
}
