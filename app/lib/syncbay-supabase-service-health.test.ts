import assert from "node:assert/strict";
import { test } from "vitest";

import * as supabaseServiceHealth from "./syncbay-supabase-service-health.ts";

const {
  SUPABASE_HTTP_SERVICE_CHECKS,
  buildSupabaseServiceHeaders,
  classifySupabaseServiceResponse,
  getSupabaseRlsDeniedReason,
  getSupabaseRestrictionReason,
} = supabaseServiceHealth;

test("checks PostgREST through a table query with expected RLS denial", () => {
  assert.deepEqual(
    SUPABASE_HTTP_SERVICE_CHECKS.find((check) => check.id === "postgrest"),
    {
      allowRlsDenied: true,
      id: "postgrest",
      label: "PostgREST",
      path: "/rest/v1/Shop?select=id&limit=1",
    },
  );
});

test("builds Supabase HTTP headers with both apikey and bearer token", () => {
  assert.deepEqual(buildSupabaseServiceHeaders("anon-key"), {
    apikey: "anon-key",
    authorization: "Bearer anon-key",
  });
});

test("rejects an empty API key before a diagnostic can hit Supabase anonymously", () => {
  assert.throws(
    () => buildSupabaseServiceHeaders("  "),
    /API key Supabase mancante/,
  );
});

test("classifies missing API key separately from quota restrictions", () => {
  assert.deepEqual(
    classifySupabaseServiceResponse({
      bodyText:
        '{"message":"No API key found in request","hint":"No `apikey` request header or url param was found."}',
      status: 401,
    }),
    {
      message:
        "No API key found in request No `apikey` request header or url param was found.",
      reason: "missing_api_key",
      status: "missing_api_key",
      statusCode: 401,
    },
  );

  assert.deepEqual(
    classifySupabaseServiceResponse({
      bodyText:
        '{"message":"Service for this project is restricted due to the following violations: exceed_egress_quota."}',
      status: 402,
    }),
    {
      message:
        "Service for this project is restricted due to the following violations: exceed_egress_quota.",
      reason: "exceed_egress_quota",
      status: "restricted",
      statusCode: 402,
    },
  );
});

test("treats expected RLS denial as a healthy PostgREST probe only when allowed", () => {
  const response = {
    bodyText: '{"message":"permission denied for table Shop"}',
    status: 403,
  };

  assert.deepEqual(
    classifySupabaseServiceResponse({
      ...response,
      allowRlsDenied: true,
    }),
    {
      message: "permission denied for table Shop",
      reason: "rls_denied",
      status: "healthy",
      statusCode: 403,
    },
  );
  assert.deepEqual(classifySupabaseServiceResponse(response), {
    message: "permission denied for table Shop",
    reason: null,
    status: "unhealthy",
    statusCode: 403,
  });
});

test("extracts known Supabase restriction reasons from response text", () => {
  assert.equal(
    getSupabaseRestrictionReason(
      "restricted due to the following violations: exceed_egress_quota",
    ),
    "exceed_egress_quota",
  );
  assert.equal(getSupabaseRestrictionReason("temporary outage"), null);
});

test("extracts expected Supabase RLS denial reasons", () => {
  assert.equal(
    getSupabaseRlsDeniedReason("permission denied for table Shop"),
    "rls_denied",
  );
  assert.equal(getSupabaseRlsDeniedReason("Invalid API key"), null);
});
