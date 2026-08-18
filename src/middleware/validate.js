'use strict';

const { createError } = require('../lib/httpErrors');

module.exports = function validateBody(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(createError(400, 'Invalid request body', { code: 'invalid_request', issues }));
    }
    req.body = result.data;
    next();
  };
};