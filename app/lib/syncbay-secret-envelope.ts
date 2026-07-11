export function isEncryptedSecretEnvelope(value: string) {
  const [version, iv, tag, ciphertext, ...extra] = value.split(".");

  return (
    version === "v1" &&
    Boolean(iv) &&
    Boolean(tag) &&
    Boolean(ciphertext) &&
    extra.length === 0
  );
}
