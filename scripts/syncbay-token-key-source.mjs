export function selectTokenEncryptionKey(input) {
  const keychainValue = normalizeSecret(input.keychainValue);
  if (keychainValue) {
    return {
      source: "keychain",
      value: keychainValue,
    };
  }

  const envValue = normalizeSecret(input.envValue);
  if (envValue) {
    return {
      source: "env",
      value: envValue,
    };
  }

  return {
    source: "missing",
    value: null,
  };
}

function normalizeSecret(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
