require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('./client');

const PRODUCTS_FILE = path.join(__dirname, '../../clothes/products.json');
const DEFAULT_SOURCE = 'fashion-product-images-kaggle';
const DEFAULT_LICENSE = 'Kaggle Dataset License';

function normalizeTagList(tags = []) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean))];
}

function normalizeGender(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'unisex';
  if (['male', 'man', 'mens', 'men'].includes(text)) return 'men';
  if (['female', 'woman', 'womens', 'women'].includes(text)) return 'women';
  return 'unisex';
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeSourceId(product = {}) {
  const direct = String(
    product.sourceId
      || product.source_id
      || product.externalId
      || product.external_id
      || product.datasetItemId
      || product.dataset_item_id
      || ''
  ).trim();

  if (direct) {
    return direct;
  }

  return slugify(product.title || product.name || 'product');
}

function normalizeProduct(product = {}) {
  const title = String(product.title || product.name || '').trim();
  const imageUrl = String(product.image || product.image_url || product.url || '').trim();
  const source = String(product.source || DEFAULT_SOURCE).trim().toLowerCase() || DEFAULT_SOURCE;
  const sourceId = normalizeSourceId(product);

  const metadata = {
    ...(product.metadata && typeof product.metadata === 'object' && !Array.isArray(product.metadata)
      ? product.metadata
      : {})
  };

  if (product.url && !metadata.sourceUrl) {
    metadata.sourceUrl = product.url;
  }

  return {
    title,
    description: product.description || null,
    category: product.category || 'top',
    subcategory: product.subcategory || product.category || 'other',
    gender: normalizeGender(product.gender),
    brand: product.brand || 'Fashion Catalog',
    datasetName: product.datasetName || product.dataset_name || 'Fashion Product Images Dataset',
    datasetItemId: String(product.datasetItemId || product.dataset_item_id || sourceId || '').trim() || null,
    masterCategory: product.masterCategory || product.master_category || null,
    articleType: product.articleType || product.article_type || null,
    baseColour: product.baseColour || product.base_colour || null,
    season: product.season || null,
    usage: product.usage || null,
    releaseYear: Number.isFinite(Number(product.releaseYear || product.release_year))
      ? Number(product.releaseYear || product.release_year)
      : null,
    imageUrl,
    thumbnailUrl: String(product.thumbnail || product.thumbnail_url || imageUrl).trim(),
    color: product.color || '#CCCCCC',
    price: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
    currency: product.currency || 'USD',
    source,
    sourceId,
    photographer: product.photographer || null,
    license: product.license || DEFAULT_LICENSE,
    metadata,
    tags: normalizeTagList(product.tags || [])
  };
}

function loadProductsFromJson() {
  if (!fs.existsSync(PRODUCTS_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((product) => normalizeProduct(product))
      .filter((product) => product.title && product.imageUrl && product.source && product.sourceId);
  } catch (error) {
    console.warn('[db:seed] failed to parse clothes/products.json:', error.message);
    return [];
  }
}

async function upsertProduct(client, product) {
  const upsertResult = await client.query(
    `INSERT INTO products (
      name,
      title,
      description,
      category,
      subcategory,
      gender,
      brand,
      dataset_name,
      dataset_item_id,
      master_category,
      article_type,
      base_colour,
      season,
      usage,
      release_year,
      image_url,
      thumbnail_url,
      color,
      price,
      currency,
      source,
      source_id,
      external_id,
      photographer,
      license,
      metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22, $23, $24,
      $25, $26::jsonb
    )
    ON CONFLICT (source, source_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      subcategory = EXCLUDED.subcategory,
      gender = EXCLUDED.gender,
      brand = EXCLUDED.brand,
      dataset_name = EXCLUDED.dataset_name,
      dataset_item_id = EXCLUDED.dataset_item_id,
      master_category = EXCLUDED.master_category,
      article_type = EXCLUDED.article_type,
      base_colour = EXCLUDED.base_colour,
      season = EXCLUDED.season,
      usage = EXCLUDED.usage,
      release_year = EXCLUDED.release_year,
      image_url = EXCLUDED.image_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      color = EXCLUDED.color,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      external_id = EXCLUDED.external_id,
      photographer = EXCLUDED.photographer,
      license = EXCLUDED.license,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted`,
    [
      product.title,
      product.title,
      product.description,
      product.category,
      product.subcategory,
      product.gender,
      product.brand,
      product.datasetName,
      product.datasetItemId,
      product.masterCategory,
      product.articleType,
      product.baseColour,
      product.season,
      product.usage,
      product.releaseYear,
      product.imageUrl,
      product.thumbnailUrl,
      product.color,
      product.price,
      product.currency,
      product.source,
      product.sourceId,
      product.sourceId,
      product.photographer,
      product.license,
      JSON.stringify(product.metadata || {})
    ]
  );

  const productId = upsertResult.rows[0].id;
  const inserted = Boolean(upsertResult.rows[0].inserted);
  const tags = normalizeTagList(product.tags);

  await client.query('DELETE FROM product_tags WHERE product_id = $1', [productId]);
  if (tags.length > 0) {
    await client.query(
      'INSERT INTO product_tags (product_id, tag) SELECT $1, UNNEST($2::text[]) ON CONFLICT DO NOTHING',
      [productId, tags]
    );
  }

  return { productId, inserted };
}

async function seedDefaultProductsIfEmpty() {
  const products = loadProductsFromJson();
  if (products.length === 0) {
    return { inserted: 0, updated: 0, total: 0, skipped: false };
  }

  const result = await withTransaction(async (client) => {
    let inserted = 0;
    let updated = 0;

    for (const product of products) {
      const upsertResult = await upsertProduct(client, product);
      if (upsertResult.inserted) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }

    return {
      inserted,
      updated,
      total: products.length,
      skipped: false
    };
  });

  return result;
}

async function runSeed() {
  const result = await seedDefaultProductsIfEmpty();
  console.log(`[db:seed] synced products: total=${result.total}, inserted=${result.inserted}, updated=${result.updated}`);
}

if (require.main === module) {
  runSeed()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[db:seed] failed:', error);
      await pool.end();
      process.exit(1);
    });
}

module.exports = {
  seedDefaultProductsIfEmpty,
  loadProductsFromJson
};
