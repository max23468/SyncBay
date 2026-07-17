#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function checkDocs(root = process.cwd()) {
  const failures = [];
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const docs = list(path.join(root, "docs")).filter((file) =>
    file.endsWith(".md"),
  );
  for (const file of docs) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const [href, anchor] = match[1].split("#", 2);
      if (/^(?:https?:|mailto:)/u.test(href)) continue;
      const target = path.resolve(
        path.dirname(file),
        decodeURIComponent(href || path.basename(file)),
      );
      if (!fs.existsSync(target)) {
        failures.push(`${path.relative(root, file)}: link mancante ${href}`);
      } else if (anchor && target.endsWith(".md")) {
        const anchors = new Set(
          fs
            .readFileSync(target, "utf8")
            .match(/^#{1,6}\s+(.+)$/gmu)
            ?.map((heading) =>
              heading
                .replace(/^#{1,6}\s+/u, "")
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s-]/gu, "")
                .trim()
                .replace(/\s+/gu, "-"),
            ) ?? [],
        );
        if (!anchors.has(decodeURIComponent(anchor).toLowerCase()))
          failures.push(
            `${path.relative(root, file)}: anchor mancante #${anchor}`,
          );
      }
    }
    // I piani in docs/superpowers/plans sono fotografie storiche: i comandi
    // npm citati lì non devono restare allineati al package.json corrente.
    if (file.includes(`${path.sep}superpowers${path.sep}plans${path.sep}`))
      continue;
    for (const match of content.matchAll(/npm run ([\w:-]+)/gu)) {
      if (!packageJson.scripts[match[1]])
        failures.push(
          `${path.relative(root, file)}: script npm inesistente ${match[1]}`,
        );
    }
  }
  const index = fs.readFileSync(path.join(root, "docs/INDEX.md"), "utf8");
  for (const match of index.matchAll(
    /`((?:guides|decisions|superpowers|market)\/[^`]+\.md)`/gu,
  )) {
    if (!fs.existsSync(path.join(root, "docs", match[1])))
      failures.push(`docs/INDEX.md: voce indicizzata mancante ${match[1]}`);
  }
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const file of tracked)
    if (
      /(?:^|\/)(?:\.DS_Store|build|coverage|screenshots?|dumps?|exports?)(?:\/|$)/iu.test(
        file,
      )
    )
      failures.push(`${file}: output generato tracciato`);
  return failures;
}

function list(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? list(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = checkDocs();
  failures.forEach((failure) => console.error(failure));
  console.log(
    failures.length === 0
      ? "Documentazione verificata."
      : `${failures.length} errori documentali.`,
  );
  if (failures.length > 0) process.exitCode = 2;
}
