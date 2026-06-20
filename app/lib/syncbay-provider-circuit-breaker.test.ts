import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as breaker from "./syncbay-provider-circuit-breaker.ts";

const {
  createClosedCircuit,
  evaluateCircuit,
  getCircuitCooldownSeconds,
  isRetryableProviderFailure,
  recordProviderFailure,
  recordProviderSuccess,
} = breaker;

const now = new Date("2026-06-20T10:00:00.000Z");

test("recognizes transient provider failures only", () => {
  assert.equal(isRetryableProviderFailure({ statusCode: 429 }), true);
  assert.equal(isRetryableProviderFailure({ statusCode: 503 }), true);
  assert.equal(
    isRetryableProviderFailure({ message: "Usage limit exceeded" }),
    true,
  );
  assert.equal(isRetryableProviderFailure({ statusCode: 422 }), false);
  assert.equal(
    isRetryableProviderFailure({ message: "Invalid SKU payload" }),
    false,
  );
});

test("stays closed below the failure threshold", () => {
  const after = recordProviderFailure(createClosedCircuit(), {
    failureThreshold: 3,
    now,
  });

  assert.equal(after.state, "closed");
  assert.equal(after.consecutiveFailures, 1);
  assert.equal(evaluateCircuit(after, now).allowRequest, true);
});

test("opens once the threshold is reached and suspends requests", () => {
  let circuit = createClosedCircuit();
  for (let i = 0; i < 3; i += 1) {
    circuit = recordProviderFailure(circuit, { failureThreshold: 3, now });
  }

  assert.equal(circuit.state, "open");
  assert.equal(circuit.openedCount, 1);
  assert.ok(circuit.openUntil instanceof Date);

  const evaluation = evaluateCircuit(circuit, now);
  assert.equal(evaluation.allowRequest, false);
  assert.equal(evaluation.state, "open");
  assert.deepEqual(evaluation.retryAt, circuit.openUntil);
});

test("allows a half-open probe after the cooldown", () => {
  let circuit = createClosedCircuit();
  for (let i = 0; i < 3; i += 1) {
    circuit = recordProviderFailure(circuit, {
      baseCooldownSeconds: 60,
      failureThreshold: 3,
      now,
    });
  }

  const beforeCooldown = new Date(now.getTime() + 59 * 1000);
  assert.equal(evaluateCircuit(circuit, beforeCooldown).allowRequest, false);

  const afterCooldown = new Date(now.getTime() + 60 * 1000);
  const evaluation = evaluateCircuit(circuit, afterCooldown);
  assert.equal(evaluation.allowRequest, true);
  assert.equal(evaluation.state, "half_open");
});

test("a success closes the circuit again", () => {
  const closed = recordProviderSuccess();
  assert.deepEqual(closed, createClosedCircuit());
});

test("cooldown grows exponentially up to the cap", () => {
  assert.equal(
    getCircuitCooldownSeconds(1, { baseCooldownSeconds: 60 }),
    60,
  );
  assert.equal(
    getCircuitCooldownSeconds(2, { baseCooldownSeconds: 60 }),
    120,
  );
  assert.equal(
    getCircuitCooldownSeconds(3, { baseCooldownSeconds: 60 }),
    240,
  );
  assert.equal(
    getCircuitCooldownSeconds(20, {
      baseCooldownSeconds: 60,
      maxCooldownSeconds: 1800,
    }),
    1800,
  );
});
