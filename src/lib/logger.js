'use strict';

const pino = require('pino');
const { env, isDev } = require('../config');


const logger = pino({
  level: env.LOG_LEVEL,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
      }
    : undefined,
});

module.exports = logger;