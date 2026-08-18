'use strict';

const { providers: order, allowProviderOverride } = require('../config');
const { createError } = require('../lib/httpErrors');
const groq = require('./groqAdapter');
const mock = require('./mockAdapter');

const registry = { groq, mock };


const ordered = order.filter((n) => registry[n]).map((n) => registry[n]);
if (ordered.length === 0) {
  throw new Error(`No valid providers configured. PROVIDERS="${order.join(',')}"`);
}

function getPrimary() {
  return ordered[0];
}
function listProviders() {
  return ordered.map((a) => a.name);
}

function resolveProvider(req) {
  if (allowProviderOverride) {
    const override = req.headers['x-llm-provider'];
    if (override) {
      const adapter = registry[override];
      if (!adapter) {
        throw createError(400, `Unknown provider override: "${override}". Known: ${Object.keys(registry).join(', ')}`, {
          code: 'unknown_provider',
        });
      }
      return adapter;
    }
  }
  return getPrimary();
}

module.exports = { getPrimary, listProviders, resolveProvider, ordered };