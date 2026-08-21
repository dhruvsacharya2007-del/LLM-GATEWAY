'use strict';

const { buildCacheKey, hashBody } = require('./cacheKey');


const { KEY_VERSION } = require('./cacheKey');

const DEFAULT_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 86400);


const BYPASS = Object.freeze({
  NONE: 'none',
  NO_CACHE: 'no-cache', 
  NO_STORE: 'no-store', 
  OFF: 'off',           
});

function parseCacheDirective(headerValue) {
  if (!headerValue) return BYPASS.NONE;
  const v = String(headerValue).trim().toLowerCase();
  if (v === BYPASS.NO_CACHE) return BYPASS.NO_CACHE;
  if (v === BYPASS.NO_STORE) return BYPASS.NO_STORE;
  if (v === BYPASS.OFF) return BYPASS.OFF;
  return BYPASS.NONE;
}

function readAllowed(directive) {
  return directive !== BYPASS.NO_CACHE && directive !== BYPASS.OFF;
}
function writeAllowed(directive) {
  return directive !== BYPASS.NO_STORE && directive !== BYPASS.OFF;
}


function isCacheable(httpStatus, body) {
  if (httpStatus !== 200) {
    return { cacheable: false, reason: 'non_200' };
  }
  const choice = body && body.choices && body.choices[0];
  if (!choice) {
    return { cacheable: false, reason: 'no_choice' };
  }
  if (choice.finish_reason !== 'stop') {
   
    return { cacheable: false, reason: `finish_${choice.finish_reason}` };
  }
  if (!body.usage || typeof body.usage.total_tokens !== 'number') {
    
    return { cacheable: false, reason: 'no_usage' };
  }
  return { cacheable: true, reason: 'ok' };
}

async function getCached(redis, body, namespace = 'global') {
  const key = buildCacheKey(body, namespace);
  const raw = await redis.get(key);
  if (!raw) return { hit: false, key };

  try {
    const envelope = JSON.parse(raw);
    return {
      hit: true,
      body: envelope.body,
      cachedAt: envelope.cached_at,
      key,
    };
  } catch (err) {
    
    return { hit: false, key };
  }
}

async function setCached(redis, body, responseBody, opts = {}) {
  const namespace = opts.namespace || 'global';
  const ttl = opts.ttlSeconds || DEFAULT_TTL_SECONDS;
  const key = buildCacheKey(body, namespace);

  const envelope = {
    key_version: KEY_VERSION,
    cached_at: new Date().toISOString(),
    body: responseBody,
  };


  await redis.set(key, JSON.stringify(envelope), { EX: ttl });
  return key;
}


function synthesizeSSEFrames(body, includeUsage) {
  const id = body.id || 'chatcmpl-cache';
  const created = body.created || Math.floor(Date.now() / 1000);
  const model = body.model || 'unknown';
  const choice = (body.choices && body.choices[0]) || {};
  const message = choice.message || {};
  const content = message.content != null ? message.content : '';

  const base = { id, object: 'chat.completion.chunk', created, model };

  const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

  const frames = [];


  frames.push(
    frame({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
  );
  frames.push(
    frame({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] })
  );
  frames.push(
    frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  );
  if (includeUsage && body.usage) {
    frames.push(frame({ ...base, choices: [], usage: body.usage }));
  }
  frames.push('data: [DONE]\n\n');

  return frames;
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  BYPASS,
  parseCacheDirective,
  readAllowed,
  writeAllowed,
  isCacheable,
  getCached,
  setCached,
  synthesizeSSEFrames,

  hashBody,
};