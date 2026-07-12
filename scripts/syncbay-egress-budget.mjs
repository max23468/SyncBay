#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildEgressBudgetReport,
  getEgressBudgetReadRows,
  isEgressReadStatementQuery,
} from "../app/lib/syncbay-egress-budget.ts";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const topLimit = args.top ?? 10;
const MASSIVE_PAYLOAD_ROWS_THRESHOLD = 1_000;
const MASSIVE_PAYLOAD_AVG_ROWS_PER_CALL_THRESHOLD = 20;

const diagnosticsSql = `
with statement_rows as (
  select
    queryid::text as "queryId",
    calls::bigint as calls,
    rows::bigint as rows,
    left(regexp_replace(query, '\\s+', ' ', 'g'), 240) as "queryPreview",
    query ~* '^\\s*(select|with)(\\s|$)' as is_read,
    query ilike '%ProductSnapshot%' and query ilike '%payload%' as is_payload
  from pg_stat_statements
  where query not ilike '%pg_stat_statements%'
    and query not ilike '%pg_stat_statements_info%'
),
reset_info as (
  select stats_reset, now() as observed_at
  from pg_stat_statements_info
  limit 1
)
select jsonb_build_object(
  'aggregated', true,
  'observedAt', reset_info.observed_at,
  'statsReset', reset_info.stats_reset,
  'windowMinutes', round((extract(epoch from (reset_info.observed_at - reset_info.stats_reset)) / 60)::numeric, 2),
  'statementCount', (select count(*)::int from statement_rows),
  'totalCalls', (select coalesce(sum(calls),0)::bigint from statement_rows),
  'totalRows', (select coalesce(sum(rows),0)::bigint from statement_rows),
  'selectStatementCount', (select count(*)::int from statement_rows where is_read),
  'selectCalls', (select coalesce(sum(calls),0)::bigint from statement_rows where is_read),
  'selectRows', (select coalesce(sum(rows),0)::bigint from statement_rows where is_read),
  'payloadStatementCount', (select count(*)::int from statement_rows where is_payload),
  'payloadCalls', (select coalesce(sum(calls),0)::bigint from statement_rows where is_payload),
  'payloadRows', (select coalesce(sum(rows),0)::bigint from statement_rows where is_payload),
  'payloadReadStatementCount', (select count(*)::int from statement_rows where is_payload and is_read),
  'payloadReadCalls', (select coalesce(sum(calls),0)::bigint from statement_rows where is_payload and is_read),
  'payloadReadRows', (select coalesce(sum(rows),0)::bigint from statement_rows where is_payload and is_read),
  'topByCalls', coalesce((select jsonb_agg(to_jsonb(t)) from (
    select "queryId", calls, rows, "queryPreview" from statement_rows order by calls desc, rows desc limit 50
  ) t), '[]'::jsonb),
  'topBySelectRows', coalesce((select jsonb_agg(to_jsonb(t)) from (
    select "queryId", calls, rows, "queryPreview" from statement_rows where is_read order by rows desc, calls desc limit 50
  ) t), '[]'::jsonb)
) as diagnostics
from reset_info;
`;

await main().catch((error) => {
  console.error(`Monitoraggio egress non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const result = await querySupabaseJson(diagnosticsSql);
  const diagnostics = buildDiagnostics(result.rows?.[0]?.diagnostics);

  if (!diagnostics) {
    throw new Error("Supabase CLI non ha restituito le statistiche attese.");
  }

  const budget = buildEgressBudgetReport({
    estimatedAverageBytesPerRow: args.avgBytesPerRow,
    monthlyBudgetGb: args.budgetGb,
    totalRows: getEgressBudgetReadRows({
      selectRows: Number(diagnostics.selectRows ?? 0),
      totalRows: Number(diagnostics.totalRows ?? 0),
    }),
    windowMinutes: Number(diagnostics.windowMinutes ?? 0),
  });
  const payload = { budget, diagnostics };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printSummary(payload);
}

function buildDiagnostics(rawDiagnostics) {
  if (!rawDiagnostics) return null;

  if (rawDiagnostics.aggregated === true) {
    const totalCalls = normalizeCount(rawDiagnostics.totalCalls);
    const totalRows = normalizeCount(rawDiagnostics.totalRows);
    const selectCalls = normalizeCount(rawDiagnostics.selectCalls);
    const selectRows = normalizeCount(rawDiagnostics.selectRows);
    const payloadCalls = normalizeCount(rawDiagnostics.payloadCalls);
    const payloadRows = normalizeCount(rawDiagnostics.payloadRows);
    const payloadReadCalls = normalizeCount(rawDiagnostics.payloadReadCalls);
    const payloadReadRows = normalizeCount(rawDiagnostics.payloadReadRows);
    return {
      avgRowsPerCall: totalCalls > 0 ? round3(totalRows / totalCalls) : 0,
      observedAt: rawDiagnostics.observedAt,
      productSnapshotPayloadReads: {
        avgRowsPerCall: payloadReadCalls > 0 ? round3(payloadReadRows / payloadReadCalls) : 0,
        calls: payloadReadCalls,
        rows: payloadReadRows,
        statementCount: normalizeCount(rawDiagnostics.payloadReadStatementCount),
      },
      productSnapshotPayloadStatements: {
        avgRowsPerCall: payloadCalls > 0 ? round3(payloadRows / payloadCalls) : 0,
        calls: payloadCalls,
        rows: payloadRows,
        statementCount: normalizeCount(rawDiagnostics.payloadStatementCount),
      },
      selectAvgRowsPerCall: selectCalls > 0 ? round3(selectRows / selectCalls) : 0,
      selectCalls,
      selectRows,
      selectStatementCount: normalizeCount(rawDiagnostics.selectStatementCount),
      statementCount: normalizeCount(rawDiagnostics.statementCount),
      statsReset: rawDiagnostics.statsReset,
      topByCalls: normalizeTopQueries(rawDiagnostics.topByCalls),
      topBySelectRows: normalizeTopQueries(rawDiagnostics.topBySelectRows),
      totalCalls,
      totalRows,
      windowMinutes: Number(rawDiagnostics.windowMinutes ?? 0),
    };
  }

  const statementRows = normalizeStatementRows(rawDiagnostics.statements ?? []);
  const selectRows = statementRows.filter((row) =>
    isEgressReadStatementQuery(row.query),
  );
  const payloadStatementRows = statementRows.filter(hasProductSnapshotPayload);
  const payloadReadRows = selectRows.filter(hasProductSnapshotPayload);
  const statementSummary = summarizeStatements(statementRows);
  const selectSummary = summarizeStatements(selectRows);

  return {
    avgRowsPerCall: statementSummary.avgRowsPerCall,
    observedAt: rawDiagnostics.observedAt,
    productSnapshotPayloadReads: summarizeStatements(payloadReadRows),
    productSnapshotPayloadStatements: summarizeStatements(payloadStatementRows),
    selectAvgRowsPerCall: selectSummary.avgRowsPerCall,
    selectCalls: selectSummary.calls,
    selectRows: selectSummary.rows,
    selectStatementCount: selectSummary.statementCount,
    statementCount: statementSummary.statementCount,
    statsReset: rawDiagnostics.statsReset,
    topByCalls: buildTopQueries(statementRows, "calls"),
    topBySelectRows: buildTopQueries(selectRows, "rows"),
    totalCalls: statementSummary.calls,
    totalRows: statementSummary.rows,
    windowMinutes: Number(rawDiagnostics.windowMinutes ?? 0),
  };
}

function normalizeTopQueries(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, topLimit).map((row) => {
    const calls = normalizeCount(row.calls);
    const resultRows = normalizeCount(row.rows);
    return {
      avgRowsPerCall: calls > 0 ? round3(resultRows / calls) : 0,
      calls,
      queryId: String(row.queryId ?? ""),
      queryPreview: normalizeSqlWhitespace(row.queryPreview ?? "").slice(0, 240),
      rows: resultRows,
    };
  });
}

function normalizeStatementRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    calls: normalizeCount(row.calls),
    query: String(row.query ?? ""),
    queryId: String(row.queryId ?? ""),
    rows: normalizeCount(row.rows),
  }));
}

function summarizeStatements(rows) {
  const totals = rows.reduce(
    (summary, row) => ({
      calls: summary.calls + row.calls,
      rows: summary.rows + row.rows,
      statementCount: summary.statementCount + 1,
    }),
    { calls: 0, rows: 0, statementCount: 0 },
  );

  return {
    ...totals,
    avgRowsPerCall: totals.calls > 0 ? round3(totals.rows / totals.calls) : 0,
  };
}

function buildTopQueries(rows, primarySort) {
  return [...rows]
    .sort((left, right) => {
      if (primarySort === "calls") {
        return right.calls - left.calls || right.rows - left.rows;
      }

      return right.rows - left.rows || right.calls - left.calls;
    })
    .slice(0, topLimit)
    .map((row) => ({
      avgRowsPerCall: row.calls > 0 ? round3(row.rows / row.calls) : 0,
      calls: row.calls,
      queryId: row.queryId,
      queryPreview: normalizeSqlWhitespace(row.query).slice(0, 240),
      rows: row.rows,
    }));
}

function hasProductSnapshotPayload(row) {
  const query = row.query.toLowerCase();
  return query.includes("productsnapshot") && query.includes("payload");
}

async function querySupabaseJson(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: process.cwd(),
      env: await getSupabaseCliEnv(),
      maxBuffer: 1024 * 1024 * 10,
      timeout: 45_000,
    },
  );
  const jsonStart = findJsonStart(stdout);

  if (jsonStart < 0) {
    throw new Error("Supabase CLI non ha restituito JSON.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart));

  return Array.isArray(parsed) ? { rows: parsed } : parsed;
}

function findJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");

  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;

  return Math.min(objectStart, arrayStart);
}

function printSummary({ budget, diagnostics }) {
  const payloadReadStats = diagnostics.productSnapshotPayloadReads ?? {};
  const payloadStatementStats = diagnostics.productSnapshotPayloadStatements ?? {};

  console.log("SyncBay egress budget");
  console.log(`- stats_reset: ${diagnostics.statsReset}`);
  console.log(`- now: ${diagnostics.observedAt}`);
  console.log(
    `- finestra: ${budget.windowMinutes} min, calls ${diagnostics.totalCalls}, rows ${diagnostics.totalRows}, avg rows/call ${diagnostics.avgRowsPerCall}`,
  );
  console.log(
    `- SELECT proxy egress: calls ${diagnostics.selectCalls}, rows ${diagnostics.selectRows}, avg rows/call ${diagnostics.selectAvgRowsPerCall}`,
  );
  console.log(
    `- budget: ${budget.monthlyBudgetGb} GB/mese = ${budget.dailyBudgetMb} MB/giorno; finestra corrente ${budget.windowBudgetMb} MB`,
  );
  console.log(`- pendenza righe SELECT: ${budget.rowsPerDay} rows/giorno`);

  if (budget.status === "unestimated") {
    console.log(
      `- soglia: per restare nel budget servono al massimo ~${budget.maxAverageBytesPerRowForBudget ?? 0} byte medi per riga in questa finestra`,
    );
    console.log(
      "- stato: non stimato in MB perché pg_stat_statements espone righe, non byte; usa --avg-bytes-per-row per una simulazione.",
    );
  } else {
    console.log(
      `- stima: ${budget.estimatedWindowEgressMb} MB nella finestra, ratio budget ${budget.budgetUsageRatio}, stato ${budget.status}`,
    );
  }

  const payloadReadSummary = summarizePayloadReads(payloadReadStats);

  if (payloadReadSummary.statementCount === 0) {
    console.log(
      "- ProductSnapshot.payload: nessuna SELECT su payload rilevata nella finestra.",
    );
  } else {
    console.log(
      `- ProductSnapshot.payload SELECT: ${payloadReadSummary.statementCount} statement, calls ${payloadReadSummary.calls}, rows ${payloadReadSummary.rows}, avg rows/call ${payloadReadSummary.avgRowsPerCall} (${payloadReadSummary.massive ? "verificare" : "non massive"})`,
    );
  }

  if (Number(payloadStatementStats.statementCount ?? 0) > 0) {
    console.log(
      `- ProductSnapshot.payload statement totali: ${payloadStatementStats.statementCount}, calls ${payloadStatementStats.calls}, rows ${payloadStatementStats.rows}`,
    );
  }

  printTopQueries("Top SELECT rows", diagnostics.topBySelectRows ?? []);
  printTopQueries("Top calls", diagnostics.topByCalls ?? []);
}

function summarizePayloadReads(stats) {
  const statementCount = Number(stats.statementCount ?? 0);
  const calls = Number(stats.calls ?? 0);
  const rows = Number(stats.rows ?? 0);
  const avgRowsPerCall = calls > 0 ? Math.round((rows / calls) * 100) / 100 : 0;
  const massive =
    rows >= MASSIVE_PAYLOAD_ROWS_THRESHOLD ||
    avgRowsPerCall >= MASSIVE_PAYLOAD_AVG_ROWS_PER_CALL_THRESHOLD;

  return {
    avgRowsPerCall,
    calls,
    massive,
    rows,
    statementCount,
  };
}

function printTopQueries(title, rows) {
  console.log("");
  console.log(`${title}:`);

  for (const row of rows) {
    console.log(
      `- rows ${row.rows}, calls ${row.calls}, avg ${row.avgRowsPerCall}: ${row.queryPreview}`,
    );
  }
}

function normalizeCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeSqlWhitespace(query) {
  return String(query).replaceAll(/\s+/g, " ").trim();
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--budget-gb") {
      parsed.budgetGb = parsePositiveNumber(rawArgs[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--avg-bytes-per-row") {
      parsed.avgBytesPerRow = parsePositiveNumber(rawArgs[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--top") {
      const top = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.top = Number.isInteger(top) && top > 0 ? Math.min(top, 50) : undefined;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run egress:budget -- [--budget-gb 5] [--avg-bytes-per-row N] [--top 10] [--json]

Interroga pg_stat_statements su Supabase remoto tramite \`supabase db query --linked\`.
Lo script è read-only: misura calls/rows, top query e presenza di query su ProductSnapshot.payload.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function parsePositiveNumber(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatCliError(error) {
  const stderr =
    typeof error?.stderr === "string" ? sanitizeErrorText(error.stderr) : "";
  const message = sanitizeErrorText(error?.message ?? String(error));
  const useful = stderr || message;

  if (useful.includes("ECIRCUITBREAKER")) {
    return "Supabase ha bloccato temporaneamente nuove connessioni per troppi tentativi di autenticazione. Attendi qualche minuto e riprova.";
  }

  if (error?.signal === "SIGTERM") {
    return "timeout durante la query Supabase. Riprova tra poco o riduci il carico di query concorrenti.";
  }

  return useful.split("\n").filter(Boolean).slice(0, 3).join(" ");
}

function sanitizeErrorText(value) {
  return String(value)
    .replaceAll(/\nwith statement_rows[\s\S]*/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}
