import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const serverBuildDir = join(process.cwd(), "build", "server");
const entrypoints = findServerEntrypoints(serverBuildDir);

if (entrypoints.length !== 1) {
  console.error(
    `Atteso un solo server entrypoint React Router, trovati ${entrypoints.length}.`,
  );
  for (const entrypoint of entrypoints) {
    console.error(`- ${entrypoint}`);
  }
  process.exit(1);
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["react-router-serve", entrypoints[0]],
  {
    env: process.env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function findServerEntrypoints(directory) {
  const results = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      results.push(...findServerEntrypoints(path));
    } else if (entry === "index.js") {
      results.push(path);
    }
  }

  return results;
}
