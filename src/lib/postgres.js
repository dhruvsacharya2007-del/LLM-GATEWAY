'use strict';

const { Pool } = require('pg');
const { env } = require('../config');
const logger = require('./logger');

const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on('error', (err) => {
  logger.error({ err }, 'Postgres pool error');
});

async function pingPostgres() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0] && rows[0].ok === 1;
}

async function closePostgres() {
  await pool.end();
  logger.info('Postgres pool closed');
}

module.exports = { pool, pingPostgres, closePostgres };