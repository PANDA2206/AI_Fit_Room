// Stream Kaggle fashion archive to Supabase products without extracting files
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { Client } = require('pg');

const ARCHIVE_PATH = process.env.KAGGLE_ARCHIVE_PATH
  || path.join(process.cwd(), 'data/kagglehub-cache/datasets/paramaggarwal/fashion-product-images-dataset/1.archive');
const EXTRACTED_CSV_PATH = process.env.EXTRACTED_CSV_PATH
  || path.join(process.cwd(), 'data/fashion-product-images-dataset/styles.csv');
const PRODUCT_IMAGE_PUBLIC_BASE_URL = (process.env.PRODUCT_IMAGE_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
const SKIP_JSON = process.env.SKIP_JSON === '1';

const SOURCE = 'fashion-product-images-kaggle';
const DATASET_NAME = 'Fashion Product Images Dataset';
const BATCH_SIZE = 200;
const MAX_ITEMS = Number.parseInt(process.env.FASHION_MAX_ITEMS || '0', 10);

if (!SUPABASE_DB_URL) throw new Error('Missing SUPABASE_DB_URL');
if (!fs.existsSync(ARCHIVE_PATH) && !fs.existsSync(EXTRACTED_CSV_PATH)) {
  throw new Error(`Neither archive (${ARCHIVE_PATH}) nor extracted CSV (${EXTRACTED_CSV_PATH}) found`);
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values.map((v) => v.trim());
}

function normalizeGender(value) {
  const t = String(value || '').toLowerCase();
  if (['men', 'man', 'male', 'boy', 'boys'].includes(t)) return 'men';
  if (['women', 'woman', 'female', 'girl', 'girls'].includes(t)) return 'women';
  return 'unisex';
}

const COLOR_HEX = {
  black: '#222222', white: '#f3f3f1', blue: '#4d74a9', navy: '#2f4160', grey: '#8c8c8c', gray: '#8c8c8c',
  red: '#9b3a3a', green: '#4f6f4f', yellow: '#c9a54d', beige: '#cfc5b4', brown: '#7a5a47', pink: '#cf8fa3',
  purple: '#7e628f', orange: '#c47a3e'
};
function colorToHex(baseColour) {
  const norm = String(baseColour || '').toLowerCase();
  if (!norm) return '#cccccc';
  if (COLOR_HEX[norm]) return COLOR_HEX[norm];
  const first = norm.split(' ')[0];
  return COLOR_HEX[first] || '#cccccc';
}

function buildImageUrl(id) {
  if (!PRODUCT_IMAGE_PUBLIC_BASE_URL) return '';
  return `${PRODUCT_IMAGE_PUBLIC_BASE_URL}/catalog/${id}.jpg`;
}

async function loadCsv({ limit }) {
  const rows = new Map();
  if (fs.existsSync(EXTRACTED_CSV_PATH)) {
    const rl = require('readline').createInterface({ input: fs.createReadStream(EXTRACTED_CSV_PATH), crlfDelay: Infinity });
    let headers = null;
    for await (const rawLine of rl) {
      const line = rawLine.replace(/\uFEFF/g, '').trim();
      if (!line) continue;
      if (!headers) { headers = parseCsvLine(line).map((h) => h.toLowerCase()); continue; }
      const vals = parseCsvLine(line);
      const row = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
      const id = row.id;
      if (!id) continue;
      rows.set(id, row);
      if (limit > 0 && rows.size >= limit) break;
    }
    return rows;
  }

  const archiveStream = fs.createReadStream(ARCHIVE_PATH).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of archiveStream) {
    if (entry.type !== 'File') { entry.autodrain(); continue; }
    if (!entry.path.endsWith('styles.csv')) { entry.autodrain(); continue; }

    let headers = null;
    const rl = require('readline').createInterface({ input: entry, crlfDelay: Infinity });
    for await (const rawLine of rl) {
      const line = rawLine.replace(/\uFEFF/g, '').trim();
      if (!line) continue;
      if (!headers) { headers = parseCsvLine(line).map((h) => h.toLowerCase()); continue; }
      const vals = parseCsvLine(line);
      const row = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
      const id = row.id;
      if (!id) continue;
      rows.set(id, row);
      if (limit > 0 && rows.size >= limit) break;
    }
    break; // styles.csv handled
  }
  return rows;
}

async function loadJsonMetadata(rows, maxItems) {
  if (SKIP_JSON) {
    console.log('[meta] skipping json load (SKIP_JSON=1)');
    return 0;
  }
  const directory = await unzipper.Open.file(ARCHIVE_PATH);
  const styleEntries = directory.files.filter((f) => f.type === 'File' && f.path.includes('/styles/') && f.path.endsWith('.json'));
  let count = 0;
  for (const entry of styleEntries) {
    const id = path.basename(entry.path, '.json');
    if (!rows.has(id)) continue;
    try {
      const buf = await entry.buffer();
      const json = JSON.parse(buf.toString('utf8'));
      rows.set(id, { ...rows.get(id), __meta: json });
      count += 1;
      if (count % 1000 === 0) console.log(`[meta] loaded ${count}`);
      if (maxItems > 0 && count >= maxItems) break;
    } catch (err) {
      console.error('[meta] failed for', id, err.message);
    }
  }
  return count;
}

function toProduct(row) {
  const id = row.id;
  const mcat = row.mastercategory || null;
  const subcat = row.subcategory || null;
  const article = row.articletype || null;
  const base = row.basecolour || null;
  const season = row.season || null;
  const usage = row.usage || null;
  const yearNum = Number.parseInt(row.year, 10);
  const releaseYear = Number.isFinite(yearNum) ? yearNum : null;
  const displayName = row.productdisplayname || '';
  const gender = normalizeGender(row.gender);
  const meta = row.__meta || null;
  const metaData = meta?.data ?? meta ?? {};
  const brand = metaData?.brandName || 'Fashion Dataset';
  const price = Number.isFinite(Number(metaData?.price)) ? Number(metaData.price) : null;
  const imageUrl = buildImageUrl(id);

  return {
    name: displayName || `${article || subcat || 'Item'} ${id}`,
    title: displayName || `${article || subcat || 'Item'} ${id}`,
    gender,
    master_category: mcat,
    subcategory: subcat,
    article_type: article,
    base_colour: base,
    season,
    usage,
    release_year: releaseYear,
    brand,
    price,
    currency: 'USD',
    image_url: imageUrl,
    thumbnail_url: imageUrl,
    color: colorToHex(base),
    source: SOURCE,
    source_id: id,
    dataset_name: DATASET_NAME,
    dataset_item_id: id,
    license: 'Kaggle Dataset License',
    metadata: metaData
  };
}

async function upsertProducts(client, products) {
  if (products.length === 0) return 0;
  const rows = products;
  const placeholders = rows.map((_, i) => {
    const base = i * 21;
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18},$${base + 19},$${base + 20},$${base + 21})`;
  }).join(',');
  const values = rows.flatMap((p) => [
    p.name,
    p.title,
    p.gender,
    p.master_category,
    p.subcategory,
    p.article_type,
    p.base_colour,
    p.season,
    p.usage,
    p.release_year,
    p.brand,
    p.price,
    p.currency,
    p.image_url,
    p.thumbnail_url,
    p.color,
    p.source,
    p.source_id,
    p.dataset_name,
    p.dataset_item_id,
    p.metadata
  ]);

  const sql = `
    INSERT INTO products
      (name, title, gender, master_category, subcategory, article_type, base_colour, season, usage, release_year,
       brand, price, currency, image_url, thumbnail_url, color, source, source_id, dataset_name, dataset_item_id, metadata)
    VALUES ${placeholders}
    ON CONFLICT (source, source_id) DO UPDATE SET
      name = EXCLUDED.name,
      title = EXCLUDED.title,
      gender = EXCLUDED.gender,
      master_category = EXCLUDED.master_category,
      subcategory = EXCLUDED.subcategory,
      article_type = EXCLUDED.article_type,
      base_colour = EXCLUDED.base_colour,
      season = EXCLUDED.season,
      usage = EXCLUDED.usage,
      release_year = EXCLUDED.release_year,
      brand = EXCLUDED.brand,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      image_url = EXCLUDED.image_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      color = EXCLUDED.color,
      dataset_name = EXCLUDED.dataset_name,
      dataset_item_id = EXCLUDED.dataset_item_id,
      metadata = EXCLUDED.metadata;
  `;
  await client.query(sql, values);
  return rows.length;
}

async function main() {
  console.log('[import] reading styles.csv from archive');
  const csvRows = await loadCsv({ limit: MAX_ITEMS });
  console.log(`[import] loaded ${csvRows.size} csv rows`);
  console.log('[import] reading JSON metadata');
  const metaCount = await loadJsonMetadata(csvRows, MAX_ITEMS);
  console.log(`[import] loaded ${metaCount} metadata entries`);
  console.log('[import] merging and upserting');

  const client = new Client({
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const products = [];
  let processed = 0;
  for (const row of csvRows.values()) {
    if (MAX_ITEMS > 0 && processed >= MAX_ITEMS) break;
    products.push(toProduct(row));
    processed += 1;
    if (products.length >= BATCH_SIZE) {
      await upsertProducts(client, products);
      console.log(`[import] upserted batch size=${products.length} total=${processed}`);
      products.length = 0;
    }
  }
  if (products.length) {
    await upsertProducts(client, products);
    console.log(`[import] upserted batch size=${products.length} total=${processed}`);
  }
  await client.end();
  console.log('[import] done');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[import] error', err.message || err);
    process.exit(1);
  });
}
