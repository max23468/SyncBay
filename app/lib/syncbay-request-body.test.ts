import assert from "node:assert/strict";
import { test } from "vitest";

import {
  parseFormDataWithLimit,
  readRequestBodyWithLimit,
  RequestBodyTooLargeError,
} from "./syncbay-request-body";

test("rejects declared and streamed bodies above the limit", async () => {
  await assert.rejects(
    readRequestBodyWithLimit(
      new Request("https://syncbay.example/webhook", {
        body: "small",
        headers: { "content-length": "1000" },
        method: "POST",
      }),
      10,
    ),
    RequestBodyTooLargeError,
  );
  await assert.rejects(
    readRequestBodyWithLimit(
      new Request("https://syncbay.example/webhook", {
        body: "01234567890",
        method: "POST",
      }),
      10,
    ),
    RequestBodyTooLargeError,
  );
});

test("parses form data after bounded buffering", async () => {
  const formData = await parseFormDataWithLimit(
    new Request("https://syncbay.example/app/settings", {
      body: "intent=saveSyncSettings",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
  );

  assert.equal(formData.get("intent"), "saveSyncSettings");
});
