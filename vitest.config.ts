import { defineConfig } from "vitest/config";

// Configurazione isolata dai test unitari: non carica il plugin reactRouter di
// vite.config.ts, che serve solo alla build dell'app. L'include e' esplicito
// perche' i test tooling (scripts/*.test.mjs) restano su node:test e non vanno
// raccolti da Vitest.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
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
