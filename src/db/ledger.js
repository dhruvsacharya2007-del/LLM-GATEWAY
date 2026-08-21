'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

/**
 * ledger.js
 * ---------
 * Owns the Postgres connection pool and the cost-ledger write path.
 *
 * Design (locked Day 5):
 *   - ONE row per request via recordRequest(). It is FIRE-AND-FORGET: it never
 *     blocks the client response and never rejects into the request path. A
 *     crash between responding and inserting loses that one analytics row —
 *     an acceptable accounting gap, NOT a delivery failure. This is explicitly
 *     NOT an outbox/queue; billing-critical events would need durable storage +
 *     a worker + idempotency, which is a different project's story.
 *   - Schema is applied idempotently at boot from 001_create_requests.sql, so
 *     there's no manual migration step in the run loop.
 *   - Costs arrive as fixed-precision DECIMAL STRINGS from pricing.js and are
 *     bound straight into NUMERIC(14,8) columns — no float touches the DB.
 *
 * Assumes a standard PG* / DATABASE_URL environment, consistent with the
 * Day 1 Compose setup. Adjust the Pool config to match your existing db module
 * if you already have one — in that case, import your pool instead of the one
 * created here and keep only initLedger + recordRequest.
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  
  max: Number(process.env.PG_POOL_MAX || 10),
});


pool.on('error', (err) => {
  console.error({ err }, 'pg pool error');
});

const MIGRATION_FILE = path.join(__dirname, '001_create_requests.sql');


async function initLedger(logger = console) {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  await pool.query(sql);
  logger.info
    ? logger.info('ledger schema ready')
    : logger.log('ledger schema ready');
}


const INSERT_SQL = `
  INSERT INTO requests (
    client_id, model, provider,
    input_tokens, output_tokens,
    total_cost, cost_saved,
    cache_hit, cache_type,
    finish_reason, status, latency_ms, request_hash
  ) VALUES (
    $1, $2, $3,
    $4, $5,
    $6, $7,
    $8, $9,
    $10, $11, $12, $13
  )
`;

function recordRequest(row, logger = console) {
  const values = [
    row.clientId,
    row.model,
    row.provider,
    row.inputTokens | 0,
    row.outputTokens | 0,
    row.totalCost != null ? row.totalCost : '0',
    row.costSaved != null ? row.costSaved : '0',
    !!row.cacheHit,
    row.cacheType || 'none',
    row.finishReason != null ? row.finishReason : null,
    row.status,
    row.latencyMs != null ? row.latencyMs : null,
    row.requestHash != null ? row.requestHash : null,
  ];

  pool
    .query(INSERT_SQL, values)
    .catch((err) => {
      const log = logger.error ? logger : console;
      log.error({ err }, 'ledger insert failed (non-fatal)');
    });
}


async function closeLedger() {
  await pool.end();
}

module.exports = {
  pool,
  initLedger,
  recordRequest,
  closeLedger,
};