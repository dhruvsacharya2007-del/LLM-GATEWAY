'use strict';

const express = require('express');
const { z } = require('zod');
const { streamProxy } = require('./streamProxy'); // <-- adjust to your path
const {
  parseCacheDirective,
  readAllowed,
  writeAllowed,
  isCacheable,
  getCached,
  setCached,
  synthesizeSSEFrames,
  hashBody,
} = require('../cache/cache');
const { computeCost } = require('../cost/pricing');
const { recordRequest } = require('../db/ledger')

const PROVIDER = {
  name: process.env.PROVIDER_NAME || 'primary',
  baseUrl: process.env.PROVIDER_BASE_URL || 'http://localhost:8081/v1',
  apiKey: process.env.PROVIDER_API_KEY || 'mock-key',
};
const INJECT_USAGE = process.env.INJECT_USAGE !== 'false';
const TTFB_TIMEOUT_MS = Number(process.env.UPSTREAM_TTFB_TIMEOUT_MS || 20000);
const IDLE_TIMEOUT_MS = Number(process.env.STREAM_IDLE_TIMEOUT_MS || 30000);
const MAX_CACHE_BYTES = Number(process.env.MAX_CACHE_BYTES || 2 * 1024 * 1024);


const chatSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.string(), content: z.any() })).min(1),
  stream: z.boolean().optional(),
}).passthrough();

function buildUpstreamPayload(body) {
  const payload = { ...body };
  if (payload.stream && INJECT_USAGE) {
    payload.stream_options = { ...(payload.stream_options || {}), include_usage: true };
  }
  return payload;
}

/**
 * SEAM (Day 5-6): fires on CLEAN completion for BOTH paths — the stream path
 * hands over the assembled canonical body, the non-stream path the raw json
 * (already canonical). One place now owns: cost accounting, the ledger row for
 * a MISS, and the gated cache write.
 *
 * ctx: { logger, clientId, body, directive, redis, requestHash, logRow }
 *   - logRow(fields) writes exactly one ledger row (fire-and-forget inside).
 *   - directive/redis/body needed for the gated setCached write.
 */
function makeOnComplete(ctx) {
  const { logger, body, directive, redis, logRow } = ctx;

  return async (completion) => {
    const usage = completion.usage || {};
    const inTok = usage.prompt_tokens || 0;
    const outTok = usage.completion_tokens || 0;
    const model = completion.model || body.model;
    const finishReason = completion.choices?.[0]?.finish_reason ?? null;

    // Cost of the actual upstream call (this is a MISS by definition — a hit
    // never reaches onComplete; it returns from the read fork).
    const { totalCost, known } = computeCost(model, inTok, outTok);
    if (!known) {
      logger && logger.warn && logger.warn({ model }, 'no pricing for model');
    }

    logger && logger.info && logger.info({
      keyId: ctx.clientId, model,
      finish: finishReason,
      usage_source: completion.usage ? 'provider' : 'estimated',
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_cost: totalCost,
      chars: completion.choices?.[0]?.message?.content?.length ?? 0,
    }, 'assembled completion (cache/ledger seam)');

    // ── Ledger row for the MISS (one row per request invariant) ──
    logRow({
      provider: PROVIDER.name,
      inputTokens: inTok,
      outputTokens: outTok,
      totalCost,
      costSaved: '0',
      cacheHit: false,
      cacheType: 'none',
      finishReason,
      status: 200,
    });

    if (redis && writeAllowed(directive)) {
      const gate = isCacheable(200, completion);
      if (gate.cacheable) {
        setCached(redis, body, completion).catch((err) =>
          logger && logger.error && logger.error({ err: String(err) }, 'cache write failed (non-fatal)')
        );
      } else {
        logger && logger.debug && logger.debug({ reason: gate.reason }, 'not caching response');
      }
    }
  };
}

const router = express.Router();

router.post('/v1/chat/completions', async (req, res) => {
  const logger = req.log || (req.app.locals && req.app.locals.logger) || console;
  const redis = (req.app.locals && req.app.locals.redis) || null;

  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: { message: 'invalid request body', type: 'invalid_request_error', details: parsed.error.issues },
    });
  }
  const body = parsed.data;
  const wantsStream = body.stream === true;


  const startedAt = Date.now();
  const clientId = req.apiKeyId || 'unknown';
  const directive = parseCacheDirective(req.get('x-llm-cache'));
  const requestHash = hashBody(body);

  // A streaming hit replays a usage frame iff a live miss would have — i.e. iff
  // include_usage was (or would be) in the upstream payload.
  const includeUsage = INJECT_USAGE || !!(body.stream_options && body.stream_options.include_usage);

  // Single row-writer. Every terminal path calls this exactly once. Binds the
  // fields common to all rows; each caller supplies only what differs.
  const logRow = (fields) =>
    recordRequest({
      clientId,
      model: body.model,
      requestHash,
      latencyMs: Date.now() - startedAt,
      ...fields,
    }, logger);

  if (redis && readAllowed(directive)) {
    let cached;
    try {
      cached = await getCached(redis, body); 
    } catch (err) {
      logger.error({ err: String(err) }, 'cache read failed; treating as miss');
      cached = { hit: false };
    }

    if (cached.hit) {
      const cb = cached.body;
      const usage = cb.usage || {};
      const inTok = usage.prompt_tokens || 0;
      const outTok = usage.completion_tokens || 0;
      const { totalCost: wouldHaveCost } = computeCost(cb.model, inTok, outTok);

      res.set('X-Cache', 'HIT');

      if (wantsStream) {
        res.set('Content-Type', 'text/event-stream');
        res.set('Cache-Control', 'no-cache');
        res.set('Connection', 'keep-alive');
        res.flushHeaders && res.flushHeaders();
        for (const frame of synthesizeSSEFrames(cb, includeUsage)) res.write(frame);
        res.end();
      } else {
        res.status(200).json(cb);
      }

      logRow({
        provider: 'cache',
        inputTokens: inTok,
        outputTokens: outTok,
        totalCost: '0',
        costSaved: wouldHaveCost,
        cacheHit: true,
        cacheType: 'exact',
        finishReason: 'stop',
        status: 200,
      });
      return; 
    }
  }

  // Miss (or read bypassed). Signal it; upstream call follows.
  res.set('X-Cache', 'MISS');


 
  const extraHeaders = {};
  if (req.headers['x-mock-mode']) extraHeaders['x-mock-mode'] = String(req.headers['x-mock-mode']);

  // One AbortController drives BOTH timers and client-disconnect (Day 12 wraps
  // this whole block in a per-provider fallback loop + circuit breaker).
  const controller = new AbortController();
  const abortUpstream = () => controller.abort();

  // TTFB timer (pre-commit): connect + wait for response headers. Fires BEFORE we
  // commit to an SSE response, so it stays fallback-eligible for Day 12.
  const ttfbTimer = setTimeout(abortUpstream, TTFB_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(`${PROVIDER.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PROVIDER.apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(buildUpstreamPayload(body)),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(ttfbTimer);
    const aborted = err && err.name === 'AbortError';
    logger.error({ err: String(err), aborted }, 'upstream connect failed');
    const status = aborted ? 504 : 502;
    logRow({
      provider: PROVIDER.name,
      inputTokens: 0, outputTokens: 0,
      totalCost: '0', costSaved: '0',
      cacheHit: false, cacheType: 'none',
      finishReason: null, status,
    });
    // Pre-commit: safe to return a real HTTP status (Day 12 fallback hook).
    return res.status(status).json({
      error: {
        message: aborted ? 'upstream timed out before responding' : 'upstream unavailable',
        type: 'gateway_upstream_error',
      },
    });
  }
  clearTimeout(ttfbTimer); // headers received; TTFB phase over

  // PRE-COMMIT error handling: upstream error is a JSON body, not a stream.
  // Forward status + body verbatim. Nothing committed yet -> Day 12 can fall back.
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    let payload;
    try { payload = JSON.parse(text); }
    catch { payload = { error: { message: text || 'upstream error', type: 'gateway_upstream_error' } }; }
    logRow({
      provider: PROVIDER.name,
      inputTokens: 0, outputTokens: 0,
      totalCost: '0', costSaved: '0',
      cacheHit: false, cacheType: 'none',
      finishReason: null, status: upstream.status,
    });
    return res.status(upstream.status).json(payload);
  }

  const onComplete = makeOnComplete({
    logger, clientId, body, directive, redis, requestHash, logRow,
  });


  if (!wantsStream) {
    try {
      const json = await upstream.json();
      res.status(200).json(json);
      try { await onComplete(json); }
      catch (err) { logger.error({ err: String(err) }, 'onComplete (non-stream) failed post-delivery'); }
    } catch (err) {
      logger.error({ err: String(err) }, 'failed reading non-stream upstream body');
      if (!res.headersSent) {
        res.status(502).json({ error: { message: 'bad upstream response', type: 'gateway_upstream_error' } });
        logRow({
          provider: PROVIDER.name,
          inputTokens: 0, outputTokens: 0,
          totalCost: '0', costSaved: '0',
          cacheHit: false, cacheType: 'none',
          finishReason: null, status: 502,
        });
      }
    }
    return;
  }


  await streamProxy({
    req, res, upstream, abortUpstream, onComplete, logger,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    maxBytes: MAX_CACHE_BYTES,
  });
});

module.exports = router;