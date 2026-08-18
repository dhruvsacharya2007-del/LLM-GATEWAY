'use strict';

const { apiKeys } = require('../config');
const { createError } = require('../lib/httpErrors');


module.exports = function apiKeyAuth(req, res, next) {
  const header = (req.headers['authorization'] || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return next(
      createError(401, 'Missing or malformed Authorization header. Use: Authorization: Bearer <api-key>', {
        code: 'missing_api_key',
      })
    );
  }

  const identity = apiKeys[match[1].trim()];
  if (!identity) {
    return next(createError(401, 'Invalid API key', { code: 'invalid_api_key' }));
  }

  req.client = { id: identity.clientId, label: identity.label };
  next();
};