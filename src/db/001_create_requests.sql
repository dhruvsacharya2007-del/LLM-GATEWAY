-- 001_create_requests.sql
-- Cost ledger: exactly one row per proxied request (hit or miss).
-- Powers per-model cost accounting and the benchmark aggregates.
--
-- Design (locked Day 5):
--   * Money is NUMERIC(14,8), NEVER float. Per-token costs are sub-cent
--     fractions; NUMERIC gives exact accumulation in SUM()/AVG().
--   * Resolved costs are stored per row, so editing pricing.js later does not
--     rewrite history.
--   * cache_hit + cost_saved make "% cost saved" a straight SQL aggregate.
--   * Applied idempotently at boot (CREATE TABLE IF NOT EXISTS) by ledger.js;
--     this file also exists standalone for README/schema clarity.

CREATE TABLE IF NOT EXISTS requests (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

    client_id      TEXT         NOT NULL,          -- mapped API-key identity
    model          TEXT         NOT NULL,          -- model string from body/response
    provider       TEXT         NOT NULL,          -- real provider on miss, 'cache' on hit

    input_tokens   INTEGER      NOT NULL DEFAULT 0,
    output_tokens  INTEGER      NOT NULL DEFAULT 0,

    total_cost     NUMERIC(14,8) NOT NULL DEFAULT 0,  -- actual spend (0 on hit)
    cost_saved     NUMERIC(14,8) NOT NULL DEFAULT 0,  -- would-have-cost (0 on miss)

    cache_hit      BOOLEAN      NOT NULL DEFAULT false,
    cache_type     TEXT         NOT NULL DEFAULT 'none', -- none | exact  (| semantic later)

    finish_reason  TEXT,                             -- stop | length | ... | null
    status         INTEGER      NOT NULL,            -- HTTP status returned to client
    latency_ms     INTEGER,                          -- wall-clock for this request

    request_hash   TEXT                              -- bare sha256 body fingerprint
);

-- Time-range scans for benchmark windows ("last run", "today").
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests (created_at);

-- Per-model aggregates (cost by model, hit rate by model).
CREATE INDEX IF NOT EXISTS idx_requests_model ON requests (model);