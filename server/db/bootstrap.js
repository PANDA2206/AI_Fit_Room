const { runMigrations } = require('./migrate');
const { seedDefaultProductsIfEmpty } = require('./seed');

async function bootstrapDatabase() {
  const dbEnabled = String(process.env.DB_ENABLED || 'true').toLowerCase() !== 'false';
  if (!dbEnabled) {
    console.log('[db] bootstrap skipped (DB_ENABLED=false)');
    return;
  }

  await runMigrations();
  console.log('[db] migrations complete');

  const shouldSeedProducts = String(process.env.DB_SEED_DEFAULT_PRODUCTS || 'true').toLowerCase() !== 'false';
  if (shouldSeedProducts) {
    const seedResult = await seedDefaultProductsIfEmpty();
    if ((seedResult.inserted || 0) > 0 || (seedResult.updated || 0) > 0) {
      console.log(`[db] synced products: inserted=${seedResult.inserted || 0}, updated=${seedResult.updated || 0}`);
    } else {
      console.log('[db] default product seeding skipped');
    }
  }
}

module.exports = {
  bootstrapDatabase
};
