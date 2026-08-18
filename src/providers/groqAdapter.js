'use strict';

const { env } = require('../config');
const { createError } = require('../lib/httpErrors');

const UNSUPPORTED_FIELDS = ['logprobs', 'top_logprobs', 'logit_bias'];

function buildBody(request) {
  const body = { ...request };
  for (const f of UNSUPPORTED_FIELDS) delete body[f];
  if (body.n !== undefined && body.n !== 1) delete body.n; 
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map((m) => {
      if (m && typeof m === 'object' && 'name' in m) {
        const { name, ...rest } = m; 
        return rest;
      }
      return m;
    });
  }
  body.model = request.model || env.GROQ_MODEL; 
  body.stream = false;
  return body;
}

async function chatCompletion(request, options = {}) {
  if (!env.GROQ_API_KEY) {
    throw createError(500, 'GROQ_API_KEY is not configured', {
      provider: 'groq',
      code: 'provider_misconfigured',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${env.GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(buildBody(request)),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw createError(504, `Groq request timed out after ${env.REQUEST_TIMEOUT_MS}ms`, {
        provider: 'groq',
        code: 'upstream_timeout',
      });
    }
    throw createError(502, `Groq request failed: ${err.message}`, {
      provider: 'groq',
      code: 'upstream_unreachable',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let upstream;
    try {
      upstream = await res.json();
    } catch {
      upstream = await res.text().catch(() => undefined);
    }
    const message = (upstream && upstream.error && upstream.error.message) || `Groq returned ${res.status}`;
   
    throw createError(res.status, message, { provider: 'groq', code: 'upstream_error', upstream });
  }

  return res.json();
}


async function chatCompletionStream(request, options = {}) {
  throw createError(501, 'Groq streaming not implemented yet (Day 3)', {
    provider: 'groq',
    code: 'not_implemented',
  });
}

module.exports = { name: 'groq', chatCompletion, chatCompletionStream };