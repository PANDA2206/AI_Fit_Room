require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const { pool } = require('./client');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getMigrationFiles() {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    const appliedResult = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.filename));
    const files = await getMigrationFiles();

    for (const filename of files) {
      if (applied.has(filename)) {
        continue;
      }

      const sqlPath = path.join(MIGRATIONS_DIR, filename);
      const sql = await fs.readFile(sqlPath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`[db:migrate] applied ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      console.log('[db:migrate] complete');
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[db:migrate] failed:', error);
      await pool.end();
      process.exit(1);
    });
}

module.exports = {
  runMigrations
};
