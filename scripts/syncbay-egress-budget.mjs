#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildEgressBudgetReport,
  getEgressBudgetReadRows,
  SYNCBAY_EGRESS_READ_QUERY_SQL_PATTERN,
} from "../app/lib/syncbay-egress-budget.ts";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const topLimit = args.top ?? 10;
const MASSIVE_PAYLOAD_ROWS_THRESHOLD = 1_000;
const MASSIVE_PAYLOAD_AVG_ROWS_PER_CALL_THRESHOLD = 20;

const diagnosticsSql = `
with raw_statement_rows as (
  select
    queryid,
    calls::bigint as calls,
    rows::bigint as rows,
    query
  from pg_stat_statements
),
statement_rows as (
  select *
  from raw_statement_rows
  where query not ilike '%pg_stat_statements%'
    and query not ilike '%pg_stat_statements_info%'
),
classified_statement_rows as (
  select
    *,
    regexp_replace(query, '\\s+', ' ', 'g') ~* '${SYNCBAY_EGRESS_READ_QUERY_SQL_PATTERN}' as is_read_query
  from statement_rows
),
summary as (
  select
    count(*)::int as statement_count,
    coalesce(sum(calls), 0)::bigint as total_calls,
    coalesce(sum(rows), 0)::bigint as total_rows,
    coalesce(round((sum(rows)::numeric / nullif(sum(calls), 0)), 3), 0) as avg_rows_per_call
  from statement_rows
),
select_summary as (
  select
    count(*)::int as statement_count,
    coalesce(sum(calls), 0)::bigint as total_calls,
    coalesce(sum(rows), 0)::bigint as total_rows,
    coalesce(round((sum(rows)::numeric / nullif(sum(calls), 0)), 3), 0) as avg_rows_per_call
  from classified_statement_rows
  where is_read_query
),
reset_info as (
  select stats_reset, now() as observed_at
  from pg_stat_statements_info
  limit 1
),
payload_statements as (
  select
    count(*)::int as statement_count,
    coalesce(sum(calls), 0)::bigint as calls,
    coalesce(sum(rows), 0)::bigint as rows
  from statement_rows
  where query ilike '%ProductSnapshot%'
    and query ilike '%payload%'
),
payload_reads as (
  select
    count(*)::int as statement_count,
    coalesce(sum(calls), 0)::bigint as calls,
    coalesce(sum(rows), 0)::bigint as rows
  from classified_statement_rows
  where is_read_query
    and query ilike '%ProductSnapshot%'
    and query ilike '%payload%'
),
top_by_select_rows as (
  select coalesce(jsonb_agg(row_payload order by rows desc, calls desc), '[]'::jsonb) as rows
  from (
    select
      rows,
      calls,
      jsonb_build_object(
        'queryId', queryid::text,
        'calls', calls,
        'rows', rows,
        'avgRowsPerCall', coalesce(round((rows::numeric / nullif(calls, 0)), 3), 0),
        'queryPreview', left(regexp_replace(query, '\\s+', ' ', 'g'), 240)
      ) as row_payload
    from classified_statement_rows
    where is_read_query
    order by rows desc, calls desc
    limit ${topLimit}
  ) ranked_rows
),
top_by_calls as (
  select coalesce(jsonb_agg(row_payload order by calls desc, rows desc), '[]'::jsonb) as rows
  from (
    select
      rows,
      calls,
      jsonb_build_object(
        'queryId', queryid::text,
        'calls', calls,
        'rows', rows,
        'avgRowsPerCall', coalesce(round((rows::numeric / nullif(calls, 0)), 3), 0),
        'queryPreview', left(regexp_replace(query, '\\s+', ' ', 'g'), 240)
      ) as row_payload
    from statement_rows
    order by calls desc, rows desc
    limit ${topLimit}
  ) ranked_calls
)
select jsonb_build_object(
  'observedAt', reset_info.observed_at,
  'statsReset', reset_info.stats_reset,
  'windowMinutes', round((extract(epoch from (reset_info.observed_at - reset_info.stats_reset)) / 60)::numeric, 2),
  'statementCount', summary.statement_count,
  'totalCalls', summary.total_calls,
  'totalRows', summary.total_rows,
  'avgRowsPerCall', summary.avg_rows_per_call,
  'selectStatementCount', select_summary.statement_count,
  'selectCalls', select_summary.total_calls,
  'selectRows', select_summary.total_rows,
  'selectAvgRowsPerCall', select_summary.avg_rows_per_call,
  'productSnapshotPayloadStatements', jsonb_build_object(
    'statementCount', payload_statements.statement_count,
    'calls', payload_statements.calls,
    'rows', payload_statements.rows
  ),
  'productSnapshotPayloadReads', jsonb_build_object(
    'statementCount', payload_reads.statement_count,
    'calls', payload_reads.calls,
    'rows', payload_reads.rows
  ),
  'topBySelectRows', top_by_select_rows.rows,
  'topByCalls', top_by_calls.rows
) as diagnostics
from summary, select_summary, reset_info, payload_statements, payload_reads, top_by_select_rows, top_by_calls;
`;

await main().catch((error) => {
  console.error(`Monitoraggio egress non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const result = await querySupabaseJson(diagnosticsSql);
  const diagnostics = result.rows?.[0]?.diagnostics;

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
