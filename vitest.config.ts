import { defineConfig } from "vitest/config";

// Configurazione isolata dai test unitari: non carica il plugin reactRouter di
// vite.config.ts, che serve solo alla build dell'app. Vitest e' l'unico runner
// dei test del repository: applicativi (app) e tooling (scripts, .github).
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "scripts/*.test.mjs", ".github/scripts/*.test.mjs"],
    // I test tooling lanciano subprocess per fixture: il piu' lento impiega ~15s
    // in locale e node --test non aveva alcun timeout. Il default Vitest di 5s
    // li farebbe fallire, e due test da ~2-3s diventerebbero flaky su un runner
    // CI carico. Se un giorno serve stringere il bound sui test applicativi
    // puri, la leva e' `projects` con timeout separati per gruppo.
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["app/lib/*.ts"],
      exclude: ["app/lib/*.test.ts"],
      reporter: ["text"],
      thresholds: {
        lines: 75,
        branches: 65,
      },
    },
  },
});
