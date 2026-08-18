'use strict';

const { createApp } = require('./app');
const { env } = require('./config');
const logger = require('./lib/logger');
const { connectRedis, closeRedis } = require('./lib/redis');
const { pingPostgres, closePostgres } = require('./lib/postgres');

async function start() {

  await connectRedis();
  await pingPostgres();
  logger.info('Connected to Postgres');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`LLM Gateway listening on http://localhost:${env.PORT}`);
  });

  async function shutdown(signal) {
    logger.info(`${signal} received, shutting down...`);
    server.close(async () => {
      try {
        await Promise.allSettled([closeRedis(), closePostgres()]);
      } finally {
        process.exit(0);
      }
    });

    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});