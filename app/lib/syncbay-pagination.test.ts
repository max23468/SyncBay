import assert from "node:assert/strict";
import { test } from "vitest";

import * as pagination from "./syncbay-pagination.ts";

const { getPageWindow, normalizePage } = pagination;

test("normalizes generic page numbers", () => {
  assert.equal(normalizePage("4"), 4);
  assert.equal(normalizePage("0"), 1);
  assert.equal(normalizePage("bad"), 1);
  assert.equal(normalizePage(null), 1);
});

test("computes bounded page windows", () => {
  assert.deepEqual(getPageWindow({ page: 3, pageSize: 25, totalRows: 991 }), {
    currentEnd: 75,
    currentStart: 51,
    hasNextPage: true,
    hasPreviousPage: true,
    nextPage: 4,
    offset: 50,
    page: 3,
    pageSize: 25,
    previousPage: 2,
    totalPages: 40,
    totalRows: 991,
  });
});

test("clamps empty and out-of-range page windows", () => {
  assert.deepEqual(getPageWindow({ page: 99, pageSize: 25, totalRows: 0 }), {
    currentEnd: 0,
    currentStart: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    nextPage: null,
    offset: 0,
    page: 1,
    pageSize: 25,
    previousPage: null,
    totalPages: 1,
    totalRows: 0,
  });
});
