const express = require('express');
const { query, withTransaction } = require('../db/client');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PRODUCT_SOURCE = 'fashion-product-images-kaggle';
const DEFAULT_PRODUCT_LICENSE = 'Kaggle Dataset License';
const TRYON_PRODUCT_SOURCE = String(process.env.TRYON_PRODUCT_SOURCE || DEFAULT_PRODUCT_SOURCE)
  .trim()
  .toLowerCase();
const TRYON_MASTER_CATEGORIES = (process.env.TRYON_MASTER_CATEGORIES || 'apparel')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const PRODUCT_SELECT_SQL = `
  SELECT
    p.public_id AS id,
    p.id AS "dbId",
    COALESCE(NULLIF(p.title, ''), p.name) AS title,
    COALESCE(NULLIF(p.title, ''), p.name) AS name,
    p.description,
    p.category,
    p.subcategory,
    p.gender,
    p.brand,
    p.dataset_name AS "datasetName",
    p.dataset_item_id AS "datasetItemId",
    p.master_category AS "masterCategory",
    p.article_type AS "articleType",
    p.base_colour AS "baseColour",
    p.season,
    p.usage,
    p.release_year AS "releaseYear",
    p.image_url AS "imageUrl",
    COALESCE(p.thumbnail_url, p.image_url) AS "thumbnailUrl",
    p.image_url AS image,
    COALESCE(p.thumbnail_url, p.image_url) AS thumbnail,
    p.color,
    p.price,
    p.currency,
    p.source,
    COALESCE(NULLIF(p.source_id, ''), p.external_id) AS "sourceId",
    COALESCE(NULLIF(p.source_id, ''), p.external_id) AS "externalId",
    p.photographer,
    p.license,
    p.metadata,
    p.created_at AS "createdAt",
    p.updated_at AS "updatedAt",
    COALESCE(array_remove(array_agg(DISTINCT pt.tag), NULL), '{}') AS tags
  FROM products p
  LEFT JOIN product_tags pt ON pt.product_id = p.id
`;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseProductIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    return {
      type: 'legacy',
      value: Number.parseInt(raw, 10)
    };
  }

  if (UUID_PATTERN.test(raw)) {
    return {
      type: 'public',
      value: raw.toLowerCase()
    };
  }

  return null;
}

function buildIdentifierCondition(identifier, paramIndex = 1, alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  if (identifier.type === 'legacy') {
    return {
      clause: `${prefix}id = $${paramIndex}`,
      params: [identifier.value]
    };
  }
  return {
    clause: `${prefix}public_id = $${paramIndex}::uuid`,
    params: [identifier.value]
  };
}

function normalizeTagList(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [...new Set(tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean))];
}

function normalizeGender(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['male', 'man', 'mens', 'men'].includes(text)) return 'men';
  if (['female', 'woman', 'womens', 'women'].includes(text)) return 'women';
  if (['unisex'].includes(text)) return 'unisex';
  return 'unisex';
}

function normalizeTitle(value) {
  return String(value || '').trim();
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeSourceId(value, fallbackText = '') {
  const direct = String(value || '').trim();
  if (direct) {
    return direct;
  }

  const fallback = slugify(fallbackText);
  return fallback || null;
}

function safeObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function applyScopedFilters(filters, scope) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  if (normalizedScope !== 'tryon') {
    return filters;
  }

  return {
    ...filters,
    source: filters.source || TRYON_PRODUCT_SOURCE,
    masterCategoryList: TRYON_MASTER_CATEGORIES.length ? TRYON_MASTER_CATEGORIES : undefined
  };
}

function normalizeProductPayload(payload = {}) {
  const title = normalizeTitle(payload.title || payload.name);
  const source = String(payload.source || DEFAULT_PRODUCT_SOURCE).trim().toLowerCase() || DEFAULT_PRODUCT_SOURCE;
  const sourceId = normalizeSourceId(
    payload.sourceId || payload.source_id || payload.externalId || payload.external_id,
    `${source}-${title}`
  );

  const imageUrl = String(payload.imageUrl || payload.image_url || payload.image || '').trim();
  const thumbnailUrl = String(
    payload.thumbnailUrl || payload.thumbnail_url || payload.thumbnail || imageUrl
  ).trim();

  const metadata = {
    ...safeObject(payload.metadata)
  };

  if (payload.url && !metadata.sourceUrl) {
    metadata.sourceUrl = payload.url;
  }

  return {
    title,
    description: payload.description || null,
    category: payload.category || 'top',
    subcategory: payload.subcategory || payload.category || 'other',
    gender: normalizeGender(payload.gender),
    brand: payload.brand || 'Unknown',
    datasetName: payload.datasetName || payload.dataset_name || 'Fashion Product Images Dataset',
    datasetItemId: String(
      payload.datasetItemId
        || payload.dataset_item_id
        || payload.sourceId
        || payload.source_id
        || payload.externalId
        || payload.external_id
        || ''
    ).trim() || null,
    masterCategory: payload.masterCategory || payload.master_category || null,
    articleType: payload.articleType || payload.article_type || null,
    baseColour: payload.baseColour || payload.base_colour || null,
    season: payload.season || null,
    usage: payload.usage || null,
    releaseYear: Number.isFinite(Number(payload.releaseYear || payload.release_year))
      ? Number(payload.releaseYear || payload.release_year)
      : null,
    imageUrl,
    thumbnailUrl,
    color: payload.color || '#CCCCCC',
    price: Number.isFinite(Number(payload.price)) ? Number(payload.price) : null,
    currency: payload.currency || 'USD',
    source,
    sourceId,
    photographer: payload.photographer || null,
    license: payload.license || DEFAULT_PRODUCT_LICENSE,
    metadata,
    tags: normalizeTagList(payload.tags)
  };
}

function buildWhereClause(filters) {
  const clauses = [];
  const params = [];
  let index = 1;

  if (filters.category) {
    clauses.push(`p.category = $${index++}`);
    params.push(filters.category);
  }

  if (filters.subcategory) {
    clauses.push(`p.subcategory = $${index++}`);
    params.push(filters.subcategory);
  }

  if (filters.brand) {
    clauses.push(`LOWER(p.brand) = LOWER($${index++})`);
    params.push(filters.brand);
  }

  const masterCategoryList = Array.isArray(filters.masterCategoryList)
    ? filters.masterCategoryList
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
    : [];

  if (masterCategoryList.length > 0) {
    clauses.push(`LOWER(COALESCE(p.master_category, '')) = ANY($${index++})`);
    params.push(masterCategoryList);
  } else if (filters.masterCategory) {
    clauses.push(`LOWER(COALESCE(p.master_category, '')) = LOWER($${index++})`);
    params.push(filters.masterCategory);
  }

  if (filters.articleType) {
    clauses.push(`LOWER(COALESCE(p.article_type, '')) = LOWER($${index++})`);
    params.push(filters.articleType);
  }

  if (filters.source) {
    clauses.push(`p.source = $${index++}`);
    params.push(filters.source);
  }

  if (filters.sourceId) {
    clauses.push(`COALESCE(NULLIF(p.source_id, ''), p.external_id) = $${index++}`);
    params.push(filters.sourceId);
  }

  if (filters.gender) {
    clauses.push(`p.gender = $${index++}`);
    params.push(normalizeGender(filters.gender));
  }

  if (filters.search) {
    clauses.push(`(
      COALESCE(NULLIF(p.title, ''), p.name) ILIKE $${index}
      OR p.brand ILIKE $${index}
      OR EXISTS (
        SELECT 1
        FROM product_tags spt
        WHERE spt.product_id = p.id
          AND spt.tag ILIKE $${index}
      )
    )`);
    params.push(`%${filters.search}%`);
    index += 1;
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

async function getProductByInternalId(productId, client = null) {
  const dbClient = client || { query };
  const result = await dbClient.query(
    `${PRODUCT_SELECT_SQL}
     WHERE p.id = $1
     GROUP BY p.id`,
    [productId]
  );
  return result.rows[0] || null;
}

async function getProductByIdentifier(identifier, client = null) {
  const dbClient = client || { query };
  const condition = buildIdentifierCondition(identifier, 1, 'p');
  const result = await dbClient.query(
    `${PRODUCT_SELECT_SQL}
     WHERE ${condition.clause}
     GROUP BY p.id`,
    condition.params
  );
  return result.rows[0] || null;
}

async function insertProduct(client, payload) {
  const insertResult = await client.query(
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
      $25::jsonb
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
    RETURNING id`,
    [
      payload.title,
      payload.title,
      payload.description,
      payload.category,
      payload.subcategory,
      payload.gender,
      payload.brand,
      payload.datasetName,
      payload.datasetItemId,
      payload.masterCategory,
      payload.articleType,
      payload.baseColour,
      payload.season,
      payload.usage,
      payload.releaseYear,
      payload.imageUrl,
      payload.thumbnailUrl || payload.imageUrl,
      payload.color,
      payload.price,
      payload.currency,
      payload.source,
      payload.sourceId,
      payload.sourceId,
      payload.photographer,
      payload.license,
      JSON.stringify(payload.metadata || {})
    ]
  );

  const productId = insertResult.rows[0].id;
  const tags = normalizeTagList(payload.tags);
  if (tags.length > 0) {
    await client.query(
      'INSERT INTO product_tags (product_id, tag) SELECT $1, UNNEST($2::text[]) ON CONFLICT DO NOTHING',
      [productId, tags]
    );
  }

  return getProductByInternalId(productId, client);
}

router.get('/meta/categories', async (req, res) => {
  try {
    const filters = {
      category: req.query.category,
      subcategory: req.query.subcategory,
      brand: req.query.brand,
      masterCategory: req.query.masterCategory,
      articleType: req.query.articleType,
      source: req.query.source,
      sourceId: req.query.sourceId,
      gender: req.query.gender,
      search: typeof req.query.search === 'string' ? req.query.search.trim() : ''
    };

    const scopedFilters = applyScopedFilters(filters, req.query.scope);
    const { whereSql, params } = buildWhereClause(scopedFilters);

    const result = await query(
      `SELECT
        COALESCE(array_remove(array_agg(DISTINCT p.category), NULL), '{}') AS categories,
        COALESCE(array_remove(array_agg(DISTINCT p.subcategory), NULL), '{}') AS subcategories,
        COALESCE(array_remove(array_agg(DISTINCT p.master_category), NULL), '{}') AS mastercategories,
        COALESCE(array_remove(array_agg(DISTINCT p.article_type), NULL), '{}') AS articletypes,
        COALESCE(array_remove(array_agg(DISTINCT p.brand), NULL), '{}') AS brands,
        COALESCE(array_remove(array_agg(DISTINCT p.gender), NULL), '{}') AS genders
      FROM products p
      ${whereSql}`,
      params
    );

    const row = result.rows[0] || {};
    return res.json({
      categories: row.categories || [],
      subcategories: row.subcategories || [],
      masterCategories: row.mastercategories || [],
      articleTypes: row.articletypes || [],
      brands: row.brands || [],
      genders: row.genders || []
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;

    const filters = {
      category: req.query.category,
      subcategory: req.query.subcategory,
      brand: req.query.brand,
      masterCategory: req.query.masterCategory,
      articleType: req.query.articleType,
      source: req.query.source,
      sourceId: req.query.sourceId,
      gender: req.query.gender,
      search: typeof req.query.search === 'string' ? req.query.search.trim() : ''
    };

    const scopedFilters = applyScopedFilters(filters, req.query.scope);
    const { whereSql, params } = buildWhereClause(scopedFilters);

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM products p ${whereSql}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    const dataResult = await query(
      `${PRODUCT_SELECT_SQL}
       ${whereSql}
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      data: dataResult.rows,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  const normalized = normalizeProductPayload(req.body || {});
  if (!normalized.title || !normalized.imageUrl) {
    return res.status(400).json({ error: 'title/name and imageUrl/image are required' });
  }

  try {
    const product = await withTransaction((client) => insertProduct(client, normalized));
    return res.status(201).json(product);
  } catch (error) {
    if (String(error.message || '').includes('idx_products_source_source_id')) {
      return res.status(409).json({ error: 'Product with this source/sourceId already exists' });
    }
    return res.status(500).json({ error: error.message });
  }
});

router.post('/bulk', async (req, res) => {
  const clothes = Array.isArray(req.body?.clothes) ? req.body.clothes : null;
  if (!clothes) {
    return res.status(400).json({ error: 'clothes must be an array' });
  }

  try {
    const imported = await withTransaction(async (client) => {
      const rows = [];
      for (const item of clothes) {
        const normalized = normalizeProductPayload({
          ...item,
          source: item?.source || DEFAULT_PRODUCT_SOURCE
        });

        if (!normalized.title || !normalized.imageUrl) {
          continue;
        }

        const inserted = await insertProduct(client, normalized);
        rows.push(inserted);
      }
      return rows;
    });

    return res.status(201).json({
      message: `Imported ${imported.length} clothes`,
      imported
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/import/external', async (_req, res) => {
  return res.json({
    message: 'External import endpoint ready',
    supportedProviders: ['ailabtools', 'shopify', 'custom', 'viton-dataset', 'kaggle-fashion-supabase'],
    instructions: {
      'kaggle-fashion-supabase': 'Use server/scripts/importFashionDatasetToSupabase.js to upload Kaggle images to Supabase Storage and sync metadata.',
      ailabtools: 'Use /api/tryon/ailab for async try-on generation',
      shopify: 'Provide store URL and API key',
      custom: 'Provide endpoint and field mapping',
      'viton-dataset': 'Downloads from VITON-HD dataset'
    }
  });
});

router.get('/:id', async (req, res) => {
  const identifier = parseProductIdentifier(req.params.id);
  if (!identifier) {
    return res.status(400).json({ error: 'Invalid cloth id. Use a UUID product id.' });
  }

  try {
    const product = await getProductByIdentifier(identifier);
    if (!product) {
      return res.status(404).json({ error: 'Cloth not found' });
    }
    return res.json(product);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  const identifier = parseProductIdentifier(req.params.id);
  if (!identifier) {
    return res.status(400).json({ error: 'Invalid cloth id. Use a UUID product id.' });
  }

  const body = req.body || {};
  const updates = [];
  const params = [];
  let paramIndex = 1;

  if ('title' in body || 'name' in body) {
    const nextTitle = normalizeTitle(body.title ?? body.name);
    if (!nextTitle) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }
    updates.push(`title = $${paramIndex}`);
    updates.push(`name = $${paramIndex}`);
    params.push(nextTitle);
    paramIndex += 1;
  }

  if ('description' in body) {
    updates.push(`description = $${paramIndex++}`);
    params.push(body.description || null);
  }

  if ('category' in body) {
    updates.push(`category = $${paramIndex++}`);
    params.push(body.category || 'top');
  }

  if ('subcategory' in body) {
    updates.push(`subcategory = $${paramIndex++}`);
    params.push(body.subcategory || 'other');
  }

  if ('gender' in body) {
    updates.push(`gender = $${paramIndex++}`);
    params.push(normalizeGender(body.gender));
  }

  if ('brand' in body) {
    updates.push(`brand = $${paramIndex++}`);
    params.push(body.brand || 'Unknown');
  }

  const imageValue = body.imageUrl ?? body.image ?? body.image_url;
  if (imageValue !== undefined) {
    updates.push(`image_url = $${paramIndex++}`);
    params.push(String(imageValue || '').trim() || null);
  }

  const thumbnailValue = body.thumbnailUrl ?? body.thumbnail ?? body.thumbnail_url;
  if (thumbnailValue !== undefined) {
    updates.push(`thumbnail_url = $${paramIndex++}`);
    params.push(String(thumbnailValue || '').trim() || null);
  }

  if ('color' in body) {
    updates.push(`color = $${paramIndex++}`);
    params.push(body.color || '#CCCCCC');
  }

  if ('price' in body) {
    updates.push(`price = $${paramIndex++}`);
    params.push(Number.isFinite(Number(body.price)) ? Number(body.price) : null);
  }

  if ('currency' in body) {
    updates.push(`currency = $${paramIndex++}`);
    params.push(body.currency || 'USD');
  }

  if ('source' in body) {
    updates.push(`source = $${paramIndex++}`);
    params.push(String(body.source || DEFAULT_PRODUCT_SOURCE).trim().toLowerCase() || DEFAULT_PRODUCT_SOURCE);
  }

  if ('sourceId' in body || 'source_id' in body || 'externalId' in body || 'external_id' in body) {
    const sourceId = normalizeSourceId(
      body.sourceId ?? body.source_id ?? body.externalId ?? body.external_id,
      body.title ?? body.name ?? ''
    );
    updates.push(`source_id = $${paramIndex}`);
    updates.push(`external_id = $${paramIndex}`);
    params.push(sourceId);
    paramIndex += 1;
  }

  if ('photographer' in body) {
    updates.push(`photographer = $${paramIndex++}`);
    params.push(body.photographer || null);
  }

  if ('license' in body) {
    updates.push(`license = $${paramIndex++}`);
    params.push(body.license || DEFAULT_PRODUCT_LICENSE);
  }

  if ('datasetName' in body || 'dataset_name' in body) {
    updates.push(`dataset_name = $${paramIndex++}`);
    params.push(body.datasetName ?? body.dataset_name ?? null);
  }

  if ('datasetItemId' in body || 'dataset_item_id' in body) {
    updates.push(`dataset_item_id = $${paramIndex++}`);
    params.push(String(body.datasetItemId ?? body.dataset_item_id ?? '').trim() || null);
  }

  if ('masterCategory' in body || 'master_category' in body) {
    updates.push(`master_category = $${paramIndex++}`);
    params.push(body.masterCategory ?? body.master_category ?? null);
  }

  if ('articleType' in body || 'article_type' in body) {
    updates.push(`article_type = $${paramIndex++}`);
    params.push(body.articleType ?? body.article_type ?? null);
  }

  if ('baseColour' in body || 'base_colour' in body) {
    updates.push(`base_colour = $${paramIndex++}`);
    params.push(body.baseColour ?? body.base_colour ?? null);
  }

  if ('season' in body) {
    updates.push(`season = $${paramIndex++}`);
    params.push(body.season || null);
  }

  if ('usage' in body) {
    updates.push(`usage = $${paramIndex++}`);
    params.push(body.usage || null);
  }

  if ('releaseYear' in body || 'release_year' in body) {
    updates.push(`release_year = $${paramIndex++}`);
    params.push(Number.isFinite(Number(body.releaseYear ?? body.release_year))
      ? Number(body.releaseYear ?? body.release_year)
      : null);
  }

  if ('metadata' in body) {
    updates.push(`metadata = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(safeObject(body.metadata)));
  }

  const hasTagUpdate = 'tags' in body;
  if (updates.length === 0 && !hasTagUpdate) {
    return res.status(400).json({ error: 'No valid fields provided to update' });
  }

  try {
    const updatedProduct = await withTransaction(async (client) => {
      const existing = await getProductByIdentifier(identifier, client);
      if (!existing) {
        return null;
      }

      if (updates.length > 0) {
        await client.query(
          `UPDATE products
           SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${paramIndex}`,
          [...params, existing.dbId]
        );
      }

      if (hasTagUpdate) {
        const tags = normalizeTagList(body.tags);
        await client.query('DELETE FROM product_tags WHERE product_id = $1', [existing.dbId]);
        if (tags.length > 0) {
          await client.query(
            'INSERT INTO product_tags (product_id, tag) SELECT $1, UNNEST($2::text[]) ON CONFLICT DO NOTHING',
            [existing.dbId, tags]
          );
        }
      }

      return getProductByInternalId(existing.dbId, client);
    });

    if (!updatedProduct) {
      return res.status(404).json({ error: 'Cloth not found' });
    }
    return res.json(updatedProduct);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  const identifier = parseProductIdentifier(req.params.id);
  if (!identifier) {
    return res.status(400).json({ error: 'Invalid cloth id. Use a UUID product id.' });
  }

  try {
    const condition = buildIdentifierCondition(identifier, 1, '');
    const result = await query(
      `DELETE FROM products
       WHERE ${condition.clause}
       RETURNING public_id AS id`,
      condition.params
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cloth not found' });
    }

    return res.json({ message: 'Cloth deleted successfully', id: result.rows[0].id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
