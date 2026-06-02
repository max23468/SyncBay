export function parseRestoreEbayStockArgs(values) {
  const parsed = { skipSnapshot: false };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--help" || value === "-h") {
      parsed.help = true;
      continue;
    }
    if (value === "--confirm-real-ebay-write") {
      parsed.confirmRealEbayWrite = true;
      continue;
    }
    if (value === "--skip-snapshot") {
      parsed.skipSnapshot = true;
      continue;
    }

    if (!value.startsWith("--")) {
      throw new Error(`Argomento non riconosciuto: ${value}`);
    }

    const key = value.slice(2).replaceAll("-", "_");
    const nextValue = values[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Valore mancante per ${value}.`);
    }

    parsed[toCamelCase(key)] = nextValue;
    index += 1;
  }

  return parsed;
}

export function shouldCreateRestoreSnapshot(args) {
  return !args.skipSnapshot;
}

function toCamelCase(value) {
  return value.replaceAll(/_([a-z])/g, (_, char) => char.toUpperCase());
}
