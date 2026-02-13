const { Pool } = require('pg');

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPgConfig() {
  const hasDatabaseUrl = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim() !== '';
  const useSsl = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
  const sslConfig = useSsl ? { rejectUnauthorized: false } : false;

  if (hasDatabaseUrl) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: parseInteger(process.env.DB_POOL_MAX, 15),
      idleTimeoutMillis: parseInteger(process.env.DB_IDLE_TIMEOUT_MS, 30000),
      connectionTimeoutMillis: parseInteger(process.env.DB_CONNECT_TIMEOUT_MS, 10000),
      ssl: sslConfig
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInteger(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'virtual_tryon',
    max: parseInteger(process.env.DB_POOL_MAX, 15),
    idleTimeoutMillis: parseInteger(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: parseInteger(process.env.DB_CONNECT_TIMEOUT_MS, 10000),
    ssl: sslConfig
  };
}

const pool = new Pool(buildPgConfig());

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  withTransaction,
  closePool
};
