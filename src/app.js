'use strict';

const express = require('express');
const pinoHttp = require('pino-http');

const logger = require('./lib/logger');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health');
const chatRoutes = require('./routes/chat');

function createApp() {
  const app = express();

  app.use(requestId);
  app.use(pinoHttp({ logger, customProps: (req) => ({ reqId: req.id }) }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/', healthRoutes);
  app.use('/', chatRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: { message: 'Not found', requestId: req.id } });
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };