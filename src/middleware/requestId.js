'use strict';

const { randomUUID } = require('crypto');

module.exports = function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};