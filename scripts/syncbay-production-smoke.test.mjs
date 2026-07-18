import assert from "node:assert/strict";
import { test } from "vitest";

import {
  checkRoute,
  evaluateSmokeResults,
  formatSmokeResult,
  PRODUCTION_SMOKE_CHECKS,
} from "./syncbay-production-smoke.mjs";

function withStubbedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return run();
  } finally {
    globalThis.fetch = original;
  }
}

test("la dashboard embedded accetta il boundary auth e rifiuta una rotta esposta", () => {
  const dashboard = PRODUCTION_SMOKE_CHECKS.find(
    (check) => check.path === "/app",
  );

  // 410 e' lo stato osservato in produzione; un 200 significherebbe rotta
  // embedded raggiungibile senza sessione Shopify.
  assert.ok(dashboard.expected.includes(410));
  assert.ok(!dashboard.expected.includes(200));
  assert.ok(!dashboard.expected.includes(500));
});

test("le rotte pubbliche pretendono 200", () => {
  for (const path of ["/", "/about", "/privacy", "/terms", "/auth/login"]) {
    const check = PRODUCTION_SMOKE_CHECKS.find((item) => item.path === path);

    assert.deepEqual(check.expected, [200]);
  }
});

test("una sola rotta fuori contratto fa fallire lo smoke", () => {
  const results = [
    { label: "landing", ok: true, path: "/", status: 200 },
    { label: "privacy", ok: false, path: "/privacy", status: 500 },
  ];
  const { failures, ok } = evaluateSmokeResults(results);

  assert.equal(ok, false);
  assert.deepEqual(
    failures.map((failure) => failure.path),
    ["/privacy"],
  );
});

test("la richiesta porta il bypass e non segue i redirect", async () => {
  let seen = null;
  const result = await withStubbedFetch(
    (url, options) => {
      seen = { options, url: String(url) };

      return Promise.resolve({ status: 200 });
    },
    () =>
      checkRoute({
        baseUrl: "https://esempio.vercel.app",
        check: { expected: [200], label: "landing", path: "/" },
        secret: "segreto-di-test",
      }),
  );

  assert.equal(seen.url, "https://esempio.vercel.app/");
  assert.equal(
    seen.options.headers["x-vercel-protection-bypass"],
    "segreto-di-test",
  );
  // Senza `manual` il redirect SSO verrebbe seguito e lo smoke leggerebbe 200
  // dalla pagina di login Vercel invece dello stato reale della rotta.
  assert.equal(seen.options.redirect, "manual");
  assert.equal(result.ok, true);
});

test("uno stato fuori contratto viene riportato come fallimento", async () => {
  const result = await withStubbedFetch(
    () => Promise.resolve({ status: 302 }),
    () =>
      checkRoute({
        baseUrl: "https://esempio.vercel.app",
        check: { expected: [200], label: "landing", path: "/" },
        secret: "segreto-di-test",
      }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 302);
});

test("un errore di rete non viene confuso con un esito positivo", () => {
  const { ok } = evaluateSmokeResults([
    { error: "timeout", label: "landing", ok: false, path: "/", status: null },
  ]);

  assert.equal(ok, false);
  assert.match(
    formatSmokeResult({
      error: "timeout",
      label: "landing",
      ok: false,
      path: "/",
      status: null,
    }),
    /FALLITO landing \(\/\) -> errore: timeout/,
  );
});
