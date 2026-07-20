#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUDGETS = {
  clientTotal: 180 * 1024,
  route: 12 * 1024,
  css: 5 * 1024,
  server: 230 * 1024,
};

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

export function measureBundleBudget(root = process.cwd(), budgets = BUDGETS) {
  const clientDirectory = path.join(root, "build/client");
  const serverDirectory = path.join(root, "build/server");
  if (!fs.existsSync(clientDirectory) || !fs.existsSync(serverDirectory)) {
    throw new Error("Artefatti build mancanti: eseguire npm run build prima del budget bundle.");
  }
  const client = walk(clientDirectory);
  const server = walk(serverDirectory);
  const gzip = (file) => gzipSync(fs.readFileSync(file)).byteLength;
  const js = client.filter((file) => /\.js$/u.test(file));
  const css = client.filter((file) => /syncbay-embedded.*\.css$/u.test(file));
  const serverJs = server.filter((file) => /\.js$/u.test(file));
  if (js.length === 0 || css.length === 0 || serverJs.length === 0) {
    throw new Error("Artefatti build incompleti: bundle client, CSS o server non trovato.");
  }
  const routes = js.filter((file) => /(?:^|[/.-])app(?:[._-]|$)/u.test(path.relative(root, file)));
  const values = {
    clientTotal: js.reduce((sum, file) => sum + gzip(file), 0),
    css: css.reduce((sum, file) => sum + gzip(file), 0),
    route: Math.max(0, ...routes.map(gzip)),
    server: serverJs.reduce((sum, file) => sum + gzip(file), 0),
  };
  const exceeded = Object.entries(values).filter(([key, value]) => value > budgets[key]);
  return { budgets, exceeded, values };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.find((arg) => arg.startsWith("--root="))?.slice(7) ?? process.cwd();
  const result = measureBundleBudget(rootArg);
  console.log(JSON.stringify(result));
  if (result.exceeded.length > 0) process.exitCode = 2;
}
