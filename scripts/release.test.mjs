import assert from "node:assert/strict";
import test from "node:test";

import { splitUnreleasedBody } from "./release.mjs";

const VERSIONED = `### Correzioni

- Corretto il calcolo della scorta.`;

const NON_VERSIONED = `### Non versionato

- Aggiornata la guida operativa interna.`;

test("separa le sezioni versionate da quelle non versionate", () => {
  const split = splitUnreleasedBody(`${VERSIONED}\n\n${NON_VERSIONED}`);

  assert.equal(split.versioned, VERSIONED);
  assert.equal(split.nonVersioned, NON_VERSIONED);
});

test("un blocco solo non versionato non produce contenuto da rilasciare", () => {
  const split = splitUnreleasedBody(NON_VERSIONED);

  assert.equal(split.versioned, "");
  assert.equal(split.nonVersioned, NON_VERSIONED);
});

test("un blocco solo versionato non trattiene nulla sotto [Non rilasciato]", () => {
  const split = splitUnreleasedBody(VERSIONED);

  assert.equal(split.versioned, VERSIONED);
  assert.equal(split.nonVersioned, "");
});

test("ignora le sezioni dichiarate ma vuote", () => {
  const split = splitUnreleasedBody(`### Correzioni\n\n${NON_VERSIONED}`);

  assert.equal(split.versioned, "");
  assert.equal(split.nonVersioned, NON_VERSIONED);
});

test("tiene insieme piu' sezioni versionate nell'ordine di scrittura", () => {
  const novita = `### Novità\n\n- Nuova vista.`;
  const split = splitUnreleasedBody(`${novita}\n\n${VERSIONED}\n\n${NON_VERSIONED}`);

  assert.equal(split.versioned, `${novita}\n\n${VERSIONED}`);
  assert.equal(split.nonVersioned, NON_VERSIONED);
});
