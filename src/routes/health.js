'use strict';

const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { pingRedis } = require('../lib/redis');
const { pingPostgres } = require('../lib/postgres');

const router = express.Router();


router.get('/live', (req, res) => {
  res.json({ status: 'ok' });
});


router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const [redis, postgres] = await Promise.allSettled([
      pingRedis(),
      pingPostgres(),
    ]);

    const redisOk = redis.status === 'fulfilled' && redis.value === true;
    const postgresOk = postgres.status === 'fulfilled' && postgres.value === true;
    const allOk = redisOk && postgresOk;

    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      dependencies: {
        redis: redisOk ? 'up' : 'down',
        postgres: postgresOk ? 'up' : 'down',
      },
    });
  })
);

module.exports = router;