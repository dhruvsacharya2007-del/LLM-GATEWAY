'use strict';

const crypto = require('crypto');
const { env } = require('../config');
const { createError } = require('../lib/httpErrors');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function approxTokens(text) {
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}
function messagesToText(messages) {
  return messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
    .join('\n');
}


async function chatCompletion(request, options = {}) {
  const headers = options.headers || {};

  const fail = headers['x-mock-fail'];
  if (fail) {
    if (fail === 'timeout') {
      await sleep(env.REQUEST_TIMEOUT_MS + 100);
      throw createError(504, 'Mock upstream timed out', { provider: 'mock', code: 'upstream_timeout' });
    }
    const status = Number(fail);
    if (Number.isInteger(status) && status >= 400) {
      throw createError(status, `Mock upstream returned ${status}`, { provider: 'mock', code: 'mock_fault' });
    }
  }

  const override = headers['x-mock-latency-ms'];
  const latency =
    override !== undefined && !Number.isNaN(Number(override)) ? Number(override) : env.MOCK_LATENCY_MS;
  if (latency > 0) await sleep(latency);

  const promptText = messagesToText(request.messages);
  const hash = crypto.createHash('sha256').update(promptText).digest('hex').slice(0, 12);
  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
  const lastUserText =
    lastUser && typeof lastUser.content === 'string' ? lastUser.content : promptText;
  const content = `[mock:${hash}] You said: ${lastUserText}`;

  const promptTokens = approxTokens(promptText);
  const completionTokens = approxTokens(content);

  return {
    id: `chatcmpl-mock-${hash}`,
    object: 'chat.completion',
    created: 1700000000, 
    model: request.model || 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}


async function chatCompletionStream(request, options = {}) {
  throw createError(501, 'Mock streaming not implemented yet (Day 3)', {
    provider: 'mock',
    code: 'not_implemented',
  });
}

module.exports = { name: 'mock', chatCompletion, chatCompletionStream };