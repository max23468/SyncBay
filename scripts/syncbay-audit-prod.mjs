#!/usr/bin/env node
import { spawnSync } from "node:child_process";

// Advisory note e accettate con motivo esplicito. Chiave: identificativo GHSA.
// Una voce qui vale solo per quell'advisory: se ne esce una nuova sullo stesso
// pacchetto, l'audit torna a fallire. Rimuovere la voce quando cade il vincolo.
export const ACCEPTED_ADVISORIES = {
  "GHSA-qwww-vcr4-c8h2": {
    motivo:
      "riguarda solo le API RSC instabili, che SyncBay non usa; la correzione esiste solo in react-router 8.3.0",
    rivedere:
      "quando @vercel/react-router e @shopify/shopify-app-react-router accetteranno peer react-router 8",
  },
};

if (import.meta.main) {
  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
  });

  if (audit.error) {
    console.error(`Impossibile eseguire npm audit: ${audit.error.message}`);
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(audit.stdout || "{}");
  } catch (error) {
    console.error("Output npm audit non valido.");
    console.error(error);
    process.exit(1);
  }

  if (audit.status === 0) {
    console.log("Audit produzione pulito.");
    process.exit(0);
  }

  let vulnerabilities;
  try {
    vulnerabilities = readAuditVulnerabilities(report);
  } catch (error) {
    console.error("Audit produzione fallito.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const unexpected = findUnexpectedAuditEntries(vulnerabilities);

  if (unexpected.length > 0) {
    console.error("Audit produzione fallito.");
    for (const [name, vulnerability] of unexpected) {
      console.error(`- ${name}: ${vulnerability.severity}`);
    }
    process.exit(1);
  }

  // Le accettate si stampano a ogni giro riuscito: una waiver silenziosa
  // smette di essere una decisione e diventa un buco.
  const accepted = findAcceptedAuditEntries(vulnerabilities);
  for (const [name] of accepted) {
    const advisory = ACCEPTED_ADVISORIES[acceptedAdvisoryKey(name, vulnerabilities)];
    console.log(`- accettata ${name}: ${advisory?.motivo ?? "vedi docs/BACKLOG.md"}`);
  }

  console.log(
    accepted.length > 0
      ? `Audit produzione pulito, ${accepted.length} advisory accettate.`
      : "Audit produzione pulito.",
  );
}

export function findUnexpectedAuditEntries(vulnerabilities) {
  const waived = waivedPackages(vulnerabilities);
  return Object.entries(vulnerabilities).filter(([name]) => !waived.has(name));
}

export function findAcceptedAuditEntries(vulnerabilities) {
  const waived = waivedPackages(vulnerabilities);
  return Object.entries(vulnerabilities).filter(([name]) => waived.has(name));
}

// Un pacchetto e' coperto quando ogni sua causa lo e': un advisory diretto deve
// stare in ACCEPTED_ADVISORIES, una causa transitiva deve essere a sua volta
// coperta. Si itera perche' le catene transitive risalgono di piu' livelli.
function waivedPackages(vulnerabilities) {
  const waived = new Set();

  for (let changed = true; changed;) {
    changed = false;
    for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
      if (waived.has(name)) continue;
      const causes = vulnerability?.via ?? [];
      if (causes.length === 0) continue;

      const covered = causes.every((cause) =>
        typeof cause === "string" ? waived.has(cause) : isAcceptedAdvisory(cause),
      );

      if (covered) {
        waived.add(name);
        changed = true;
      }
    }
  }

  return waived;
}

function isAcceptedAdvisory(cause) {
  const id = advisoryIdentifier(cause);
  return id !== null && Object.hasOwn(ACCEPTED_ADVISORIES, id);
}

function advisoryIdentifier(cause) {
  const match = /GHSA-[\da-z-]+/i.exec(cause?.url ?? "");
  return match ? match[0] : null;
}

function acceptedAdvisoryKey(name, vulnerabilities) {
  const causes = vulnerabilities?.[name]?.via ?? [];
  for (const cause of causes) {
    if (typeof cause === "string") return acceptedAdvisoryKey(cause, vulnerabilities);
    const id = advisoryIdentifier(cause);
    if (id) return id;
  }
  return null;
}

export function readAuditVulnerabilities(report) {
  if (isRecord(report?.error)) {
    throw new Error("npm audit ha restituito un errore invece del report vulnerabilità.");
  }

  if (!isRecord(report?.vulnerabilities)) {
    throw new Error("npm audit non ha restituito il blocco vulnerabilities; audit non affidabile.");
  }

  return report.vulnerabilities;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
