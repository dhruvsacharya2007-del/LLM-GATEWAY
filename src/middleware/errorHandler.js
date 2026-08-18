'use strict';

const logger = require('../lib/logger');
const { isProd } = require('../config');


module.exports = function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  logger.error(
    { err, reqId: req.id, status, provider: err.provider },
    'Request failed'
  );

  const body = {
    error: {
      message: isProd && status === 500 ? 'Internal server error' : err.message,
      requestId: req.id,
    },
  };
  if (err.code) body.error.code = err.code;
  if (err.provider) body.error.provider = err.provider;
  if (err.issues) body.error.issues = err.issues;

  res.status(status).json(body);
};