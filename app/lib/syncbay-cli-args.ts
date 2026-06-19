export function parsePositiveLimitOption(
  value: string | undefined,
  optionName = "--limit",
) {
  if (value === undefined) {
    throw new Error(`${optionName} richiede un valore.`);
  }

  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new Error(`${optionName} deve essere un intero positivo.`);
  }

  return Number.parseInt(value, 10);
}
