'use strict';

const { createClient } = require('redis');
const { env } = require('../config');
const logger = require('./logger');

const redisClient = createClient({ url: env.REDIS_URL });

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis client error');
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Connected to Redis');
  }
  return redisClient;
}

async function pingRedis() {
  const res = await redisClient.ping();
  return res === 'PONG';
}

async function closeRedis() {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed');
  }
}

module.exports = { redisClient, connectRedis, pingRedis, closeRedis };