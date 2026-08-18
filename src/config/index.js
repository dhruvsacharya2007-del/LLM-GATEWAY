'use strict';

require('dotenv').config();

const { z } = require('zod');


const boolFromString = z.enum(['true', 'false']).transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  
  PROVIDERS: z.string().default('groq,mock'),
  ALLOW_PROVIDER_OVERRIDE: boolFromString.optional(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),


  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_MODEL: z.string().default('openai/gpt-oss-20b'),


  MOCK_LATENCY_MS: z.coerce.number().int().nonnegative().default(0),

  
  API_KEYS: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

const isDev = env.NODE_ENV === 'development';
const isProd = env.NODE_ENV === 'production';


const providers = env.PROVIDERS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);


const DEFAULT_API_KEYS = {
  'sk-local-dev-key': { clientId: 'dev', label: 'local dev key' },
};
const ApiKeysSchema = z.record(
  z.object({ clientId: z.string().min(1), label: z.string().optional() })
);

let apiKeys;
if (env.API_KEYS) {
  try {
    apiKeys = ApiKeysSchema.parse(JSON.parse(env.API_KEYS));
  } catch (e) {
    console.error(
      'Invalid API_KEYS (must be JSON map of key -> {clientId, label}):',
      e.message
    );
    process.exit(1);
  }
} else {
  apiKeys = DEFAULT_API_KEYS;
  if (!isProd) {
    console.warn('[config] API_KEYS not set — using built-in dev key "sk-local-dev-key".');
  }
}

const allowProviderOverride = env.ALLOW_PROVIDER_OVERRIDE ?? isDev;

module.exports = { env, isDev, isProd, providers, apiKeys, allowProviderOverride };