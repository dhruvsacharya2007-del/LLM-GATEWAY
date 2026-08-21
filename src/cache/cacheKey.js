'use strict';

const crypto = require('crypto');


const KEY_VERSION = 'v1';


const BLOCKLIST_FIELDS = ['stream', 'stream_options'];

function canonicalize(value) {
  if (Array.isArray(value)) {
    
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const out = {};
    for (const k of sortedKeys) {
      out[k] = canonicalize(value[k]);
    }
    return out;
  }
  
  return value;
}

function stripTransportFields(body) {
  const copy = { ...body };
  for (const f of BLOCKLIST_FIELDS) {
    delete copy[f];
  }
  return copy;
}

function hashBody(body) {
  const stripped = stripTransportFields(body);
  const canonical = canonicalize(stripped);
  const serialized = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}


function buildCacheKey(body, namespace = 'global') {
  return `cache:${KEY_VERSION}:${namespace}:${hashBody(body)}`;
}

module.exports = {
  KEY_VERSION,
  BLOCKLIST_FIELDS,
  canonicalize,
  hashBody,
  buildCacheKey,
};