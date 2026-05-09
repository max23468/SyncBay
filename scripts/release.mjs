#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const changelogPath = path.join(root, "CHANGELOG.md");
const versionPath = path.join(root, "app/lib/version.ts");

const validBumps = new Set(["major", "minor", "patch", "none"]);
const majorSections = new Set(["breaking", "breaking changes", "rimosso"]);
const minorSections = new Set([normalize("Novità"), "aggiunto"]);
const patchSections = new Set([
  "correzioni",
  "modificato",
  "risolto",
  "sicurezza",
  "sotto il cofano",
]);
const nonVersionedSections = new Set([
  "non versionato",
  "non rilasciabile",
  "nessuna release",
]);

function parseArgs(argv) {
  const options = {
    bump: null,
    date: null,
    dryRun: false,
    help: false,
    version: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--bump=")) {
      options.bump = arg.slice("--bump=".length);
      continue;
    }

    if (arg === "--bump") {
      options.bump = argv[++i];
      continue;
    }

    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length);
      continue;
    }

    if (arg === "--version") {
      options.version = argv[++i];
      continue;
    }

    if (arg.startsWith("--date=")) {
      options.date = arg.slice("--date=".length);
      continue;
    }

    if (arg === "--date") {
      options.date = argv[++i];
      continue;
    }

    if (!options.bump && validBumps.has(arg)) {
      options.bump = arg;
      continue;
    }

    fail(`Argomento non riconosciuto: ${arg}`);
  }

  return options;
}

function showHelp() {
  console.log(`Uso:
  npm run release
  npm run release -- --dry-run
  npm run release -- --bump patch
  npm run release -- --bump none
  npm run release -- --version 0.2.0
  npm run release -- --date 2026-05-10

Senza --bump o --version, il bump viene inferito da CHANGELOG.md:
  major  se [Non rilasciato] contiene sezioni breaking o Rimosso
  minor  se contiene Novità o Aggiunto
  patch  se contiene solo Correzioni, Sicurezza, Modificato, Risolto o Sotto il cofano
  none   se contiene solo Non versionato

Se contiene sezioni non riconosciute o mescola voci versionate e non versionate, il comando si ferma.`);
}

function fail(message) {
  console.error(`Errore release: ${message}`);
  process.exit(1);
}

function todayInRome() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Rome",
    year: "numeric",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readCurrentVersion(source) {
  const versionMatch = source.match(/export const APP_VERSION = "([^"]+)";/);
  const dateMatch = source.match(/export const BUILD_DATE = "([^"]+)";/);

  if (!versionMatch) fail("APP_VERSION non trovato in app/lib/version.ts.");
  if (!dateMatch) fail("BUILD_DATE non trovato in app/lib/version.ts.");

  return {
    buildDate: dateMatch[1],
    version: versionMatch[1],
  };
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail(`Versione SemVer non valida: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }

  return 0;
}

function bumpVersion(currentVersion, bump) {
  const [major, minor, patch] = parseVersion(currentVersion);

  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  if (bump === "none") return currentVersion;

  fail(`Bump non valido: ${bump}`);
}

function extractUnreleased(changelog, options = {}) {
  const headerRegex = /^## \[Non rilasciato\]\s*$/m;
  const headerMatch = changelog.match(headerRegex);

  if (!headerMatch || headerMatch.index === undefined) {
    fail("Blocco ## [Non rilasciato] non trovato in CHANGELOG.md.");
  }

  const bodyStart = headerMatch.index + headerMatch[0].length;
  const afterHeader = changelog.slice(bodyStart);
  const nextHeaderIndex = afterHeader.search(/\n## \[[^\]]+\]/);
  const rawBody = nextHeaderIndex === -1 ? afterHeader : afterHeader.slice(0, nextHeaderIndex);
  const body = rawBody.trim();

  if (!body && !options.allowEmpty) {
    fail("Il blocco [Non rilasciato] è vuoto. Aggiungi almeno una voce prima di rilasciare.");
  }

  return {
    afterHeader,
    beforeHeader: changelog.slice(0, headerMatch.index),
    body,
    rest: nextHeaderIndex === -1 ? "" : afterHeader.slice(nextHeaderIndex),
  };
}

function inferBump(unreleasedBody) {
  const sections = validateSections(unreleasedBody);
  const normalizedBody = normalize(unreleasedBody);
  const hasNonVersioned = sections.some(
    (section) => nonVersionedSections.has(section.title) && section.hasContent,
  );
  const hasVersioned = sections.some(
    (section) =>
      section.hasContent &&
      (majorSections.has(section.title) ||
        minorSections.has(section.title) ||
        patchSections.has(section.title)),
  );

  if (hasNonVersioned && hasVersioned) {
    fail(
      "Il blocco [Non rilasciato] mescola voci versionate e non versionate. Separa il lavoro prima di rilasciare.",
    );
  }

  if (hasNonVersioned) return "none";

  if (
    sections.some((section) => section.hasContent && majorSections.has(section.title)) ||
    /\bbreaking change\b/.test(normalizedBody)
  ) {
    return "major";
  }

  if (sections.some((section) => section.hasContent && minorSections.has(section.title))) {
    return "minor";
  }

  if (sections.some((section) => section.hasContent && patchSections.has(section.title))) {
    return "patch";
  }

  fail("Impossibile inferire la categoria dal blocco [Non rilasciato].");
}

function validateSections(unreleasedBody) {
  const sections = parseSections(unreleasedBody);
  const unknownSections = sections.filter(
    (section) =>
      !majorSections.has(section.title) &&
      !minorSections.has(section.title) &&
      !patchSections.has(section.title) &&
      !nonVersionedSections.has(section.title),
  );

  if (sections.length === 0) {
    fail("Il blocco [Non rilasciato] deve usare sezioni ### riconosciute.");
  }

  if (unknownSections.length > 0) {
    fail(
      `Sezioni changelog non riconosciute: ${unknownSections
        .map((section) => section.title)
        .join(", ")}. Usa Novità, Correzioni, Sotto il cofano, Rimosso oppure Non versionato.`,
    );
  }

  return sections;
}

function parseSections(markdown) {
  const headings = [...markdown.matchAll(/^###\s+(.+)$/gm)];

  return headings.map((heading, index) => {
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = index + 1 < headings.length ? headings[index + 1].index : markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd);

    return {
      hasContent: sectionHasContent(body),
      title: normalize(heading[1]),
    };
  });
}

function sectionHasContent(body) {
  return body.split("\n").some((line) => {
    const trimmed = line.trim();

    return trimmed && !trimmed.startsWith("<!--") && !trimmed.endsWith("-->");
  });
}

function analyzeUnreleased(unreleasedBody) {
  const sections = parseSections(unreleasedBody);
  const hasNonVersioned = sections.some(
    (section) => section.hasContent && nonVersionedSections.has(section.title),
  );
  const hasMajor = sections.some(
    (section) => section.hasContent && majorSections.has(section.title),
  );
  const hasMinor = sections.some(
    (section) => section.hasContent && minorSections.has(section.title),
  );
  const hasPatch = sections.some(
    (section) => section.hasContent && patchSections.has(section.title),
  );

  if (hasNonVersioned) return "non versionato";
  if (hasMajor) return "major";
  if (hasMinor) return "minor";
  if (hasPatch) return "patch";

  return "patch";
}

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function changelogAnchor(version, date) {
  return `#${version.replace(/\./g, "")}--${date}`;
}

function updateChangelog(changelog, release) {
  if (changelog.includes(`## [${release.version}]`)) {
    fail(`CHANGELOG.md contiene già una release ${release.version}.`);
  }

  if (changelog.includes(`[${release.version}]:`)) {
    fail(`CHANGELOG.md contiene già un link per ${release.version}.`);
  }

  const unreleased = extractUnreleased(changelog);
  const nextChangelog = `${unreleased.beforeHeader}## [Non rilasciato]\n\n## [${release.version}] — ${release.date}\n\n${unreleased.body}\n${unreleased.rest}`;
  const releaseLink = `[${release.version}]: ${changelogAnchor(release.version, release.date)}`;

  if (/^\[Non rilasciato\]: #non-rilasciato$/m.test(nextChangelog)) {
    return nextChangelog.replace(
      /^\[Non rilasciato\]: #non-rilasciato$/m,
      `[Non rilasciato]: #non-rilasciato\n${releaseLink}`,
    );
  }

  return `${nextChangelog.trimEnd()}\n\n[Non rilasciato]: #non-rilasciato\n${releaseLink}\n`;
}

function updateVersionFile(source, release) {
  return source
    .replace(
      /export const APP_VERSION = "[^"]+";/,
      `export const APP_VERSION = "${release.version}";`,
    )
    .replace(/export const BUILD_DATE = "[^"]+";/, `export const BUILD_DATE = "${release.date}";`);
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  showHelp();
  process.exit(0);
}

if (options.bump && !validBumps.has(options.bump)) {
  fail(`--bump deve essere major, minor, patch o none. Ricevuto: ${options.bump}`);
}

if (options.bump === "none" && options.version) {
  fail("--bump none non può essere usato insieme a --version.");
}

if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
  fail(`--date deve usare il formato YYYY-MM-DD. Ricevuto: ${options.date}`);
}

if (options.version && !/^\d+\.\d+\.\d+$/.test(options.version)) {
  fail(`--version deve usare il formato X.Y.Z. Ricevuto: ${options.version}`);
}

const changelog = readFileSync(changelogPath, "utf8");
const versionFile = readFileSync(versionPath, "utf8");
const current = readCurrentVersion(versionFile);
const unreleased = extractUnreleased(changelog, { allowEmpty: options.dryRun });

if (!unreleased.body) {
  console.log("Blocco [Non rilasciato] vuoto. Nessuna release SemVer da preparare.");
  console.log("Nessun file aggiornato.");
  process.exit(0);
}

validateSections(unreleased.body);
const bump = options.bump ?? (options.version ? null : inferBump(unreleased.body));
const nextVersion = options.version ?? bumpVersion(current.version, bump);
const releaseDate = options.date ?? todayInRome();
const strategy = options.version ? "versione esplicita" : `bump ${bump}`;

if (bump === "none") {
  const sections = validateSections(unreleased.body);
  const hasVersioned = sections.some(
    (section) =>
      section.hasContent &&
      (majorSections.has(section.title) ||
        minorSections.has(section.title) ||
        patchSections.has(section.title)),
  );

  if (hasVersioned) {
    fail("--bump none può essere usato solo con voci Non versionato.");
  }

  console.log("Categoria: non versionato. Nessuna release SemVer da preparare.");
  console.log("Nessun file aggiornato.");
  process.exit(0);
}

if (
  validateSections(unreleased.body).some(
    (section) => section.hasContent && nonVersionedSections.has(section.title),
  )
) {
  fail(
    "Il blocco [Non rilasciato] contiene voci Non versionato. Separale dalle voci da rilasciare prima di generare una versione.",
  );
}

if (compareVersions(nextVersion, current.version) <= 0) {
  fail(
    `La nuova versione (${nextVersion}) deve essere maggiore della versione corrente (${current.version}).`,
  );
}

const nextChangelog = updateChangelog(changelog, {
  date: releaseDate,
  version: nextVersion,
});
const nextVersionFile = updateVersionFile(versionFile, {
  date: releaseDate,
  version: nextVersion,
});

if (options.dryRun) {
  console.log(`Dry-run release SyncBay ${nextVersion} (${releaseDate})`);
  console.log(`Versione corrente: ${current.version} (${current.buildDate})`);
  console.log(`Strategia: ${strategy}`);
  console.log(`Analisi blocco [Non rilasciato]: ${analyzeUnreleased(unreleased.body)}`);
  console.log("File che verrebbero aggiornati:");
  console.log("- CHANGELOG.md");
  console.log("- app/lib/version.ts");
  process.exit(0);
}

writeFileSync(changelogPath, nextChangelog);
writeFileSync(versionPath, nextVersionFile);

console.log(`Release SyncBay ${nextVersion} preparata (${releaseDate}, ${strategy}).`);
console.log("Aggiornati CHANGELOG.md e app/lib/version.ts.");
