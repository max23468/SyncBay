#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedClientPath = resolve(projectRoot, "prisma", "generated", "client");
const prismaClientPaths = [
  resolve(projectRoot, "node_modules", ".prisma", "client"),
  resolve(projectRoot, "node_modules", "@prisma", "client", ".prisma", "client"),
];

if (!existsSync(generatedClientPath)) {
  console.warn("Prisma client generato non trovato. Esegui `prisma generate` prima del link.");
  process.exit(0);
}

for (const prismaClientPath of prismaClientPaths) {
  rmSync(prismaClientPath, { recursive: true, force: true });
  mkdirSync(prismaClientPath, { recursive: true });
  linkGeneratedClient(resolve(prismaClientPath, "default"));
  linkGeneratedClient(resolve(prismaClientPath, "index-browser"));
  linkGeneratedClient(resolve(prismaClientPath, "edge"));
}

function linkGeneratedClient(linkPath) {
  removeLegacyEntrypointFiles(linkPath);

  if (existsSync(linkPath)) {
    const stat = lstatSync(linkPath);

    if (stat.isSymbolicLink()) {
      const currentTarget = resolve(dirname(linkPath), readlinkSync(linkPath));

      if (currentTarget === generatedClientPath) return;

      unlinkSync(linkPath);
    } else {
      rmSync(linkPath, { recursive: true, force: true });
    }
  }

  symlinkSync(relative(dirname(linkPath), generatedClientPath), linkPath, "dir");
}

function removeLegacyEntrypointFiles(linkPath) {
  for (const extension of [".d.mts", ".d.ts", ".js", ".js.map", ".mjs"]) {
    const filePath = `${linkPath}${extension}`;

    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  }
}
