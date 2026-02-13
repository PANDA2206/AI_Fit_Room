require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CATALOG_API_URL = process.env.CATALOG_API_URL || 'http://localhost:5001';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_API_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'fashion-products';

// Product images can be stored in any S3-compatible bucket (Tebi, Cloudflare R2, Backblaze B2, AWS S3, Supabase S3, ...).
// Keep backwards compatibility with existing SUPABASE_S3_* env vars.
const PRODUCT_IMAGE_S3_BUCKET = process.env.PRODUCT_IMAGE_S3_BUCKET || SUPABASE_STORAGE_BUCKET;
const PRODUCT_IMAGE_S3_ENDPOINT = process.env.PRODUCT_IMAGE_S3_ENDPOINT || process.env.SUPABASE_S3_ENDPOINT || '';
const defaultS3Region = PRODUCT_IMAGE_S3_ENDPOINT.includes('tebi.io') ? 'global' : 'us-east-1';
const PRODUCT_IMAGE_S3_REGION = process.env.PRODUCT_IMAGE_S3_REGION || process.env.SUPABASE_S3_REGION || defaultS3Region;
const PRODUCT_IMAGE_S3_ACCESS_KEY_ID = process.env.PRODUCT_IMAGE_S3_ACCESS_KEY_ID || process.env.SUPABASE_S3_ACCESS_KEY_ID || '';
const PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY = process.env.PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY || process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '';
const defaultForcePathStyle = PRODUCT_IMAGE_S3_ENDPOINT.includes('supabase.co') ? 'true' : 'false';
const PRODUCT_IMAGE_S3_FORCE_PATH_STYLE = String(
  process.env.PRODUCT_IMAGE_S3_FORCE_PATH_STYLE
    ?? process.env.SUPABASE_S3_FORCE_PATH_STYLE
    ?? defaultForcePathStyle
).toLowerCase() !== 'false';
const PRODUCT_IMAGE_S3_UPLOAD_ENABLED = Boolean(
  PRODUCT_IMAGE_S3_ENDPOINT && PRODUCT_IMAGE_S3_ACCESS_KEY_ID && PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY
);

// If set, we use this as the public base URL for product images (must be publicly readable).
// Examples:
// - https://app-product.s3.tebi.io
// - https://s3.tebi.io/app-product
const PRODUCT_IMAGE_PUBLIC_BASE_URL = (process.env.PRODUCT_IMAGE_PUBLIC_BASE_URL || '').trim();

let s3Client = null;

const FASHION_DATASET_DIR = process.env.FASHION_DATASET_DIR || path.join(process.cwd(), 'data/fashion-product-images-dataset');
const STYLES_CSV_PATH = process.env.FASHION_STYLES_CSV || path.join(FASHION_DATASET_DIR, 'styles.csv');
const IMAGES_DIR = process.env.FASHION_IMAGES_DIR || path.join(FASHION_DATASET_DIR, 'images');

const FASHION_SOURCE = process.env.FASHION_SOURCE || 'fashion-product-images-kaggle';
const FASHION_DATASET_NAME = process.env.FASHION_DATASET_NAME || 'Fashion Product Images Dataset';
const FASHION_BATCH_SIZE = Math.max(1, Number.parseInt(process.env.FASHION_BATCH_SIZE || '100', 10));
const FASHION_MAX_ITEMS = Number.parseInt(process.env.FASHION_MAX_ITEMS || '0', 10);
const FASHION_UPLOAD_IMAGES = String(process.env.FASHION_UPLOAD_IMAGES || 'true').toLowerCase() !== 'false';
const FASHION_ONLY_TOPWEAR = String(process.env.FASHION_ONLY_TOPWEAR || 'true').toLowerCase() !== 'false';
const FASHION_IMPORT_METADATA = String(process.env.FASHION_IMPORT_METADATA || 'true').toLowerCase() !== 'false';

const TOPWEAR_ARTICLE_TYPES = new Set([
  'tshirts',
  'tshirt',
  'shirts',
  'shirt',
  'sweaters',
  'sweater',
  'sweatshirts',
  'sweatshirt',
  'jackets',
  'jacket',
  'hoodies',
  'hoodie',
  'cardigan',
  'cardigans',
  'tops',
  'top',
  'blazers',
  'blazer',
  'waistcoat',
  'waistcoats',
  'vest',
  'vests',
  'kurta',
  'kurtas'
]);

const COLOR_HEX = {
  black: '#222222',
  white: '#f3f3f1',
  blue: '#4d74a9',
  navy: '#2f4160',
  grey: '#8c8c8c',
  gray: '#8c8c8c',
  red: '#9b3a3a',
  green: '#4f6f4f',
  yellow: '#c9a54d',
  beige: '#cfc5b4',
  brown: '#7a5a47',
  pink: '#cf8fa3',
  purple: '#7e628f',
  orange: '#c47a3e'
};

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

async function* iterateCsvRows(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = null;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/\uFEFF/g, '');
    if (!line.trim()) {
      continue;
    }

    if (!headers) {
      headers = parseCsvLine(line).map((header) => header.trim().toLowerCase());
      continue;
    }

    const rowValues = parseCsvLine(line);
    if (rowValues.length === 0) {
      continue;
    }

    const row = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = rowValues[i] || '';
    }

    yield row;
  }
}

function normalizeGender(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['male', 'men', 'man', 'boys', 'boy'].includes(text)) return 'men';
  if (['female', 'women', 'woman', 'girls', 'girl'].includes(text)) return 'women';
  return 'unisex';
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function colorToHex(baseColour) {
  const normalized = String(baseColour || '').trim().toLowerCase();
  if (!normalized) return '#cccccc';

  if (COLOR_HEX[normalized]) {
    return COLOR_HEX[normalized];
  }

  const simple = normalized.split(' ')[0];
  return COLOR_HEX[simple] || '#cccccc';
}

function inferSubcategory(articleType, fallbackSubcategory) {
  const article = slugify(articleType);
  if (article) return article;
  const fallback = slugify(fallbackSubcategory);
  return fallback || 'top';
}

function isTopwear(row) {
  const articleType = String(row.articletype || '').trim().toLowerCase();
  const subCategory = String(row.subcategory || '').trim().toLowerCase();

  if (TOPWEAR_ARTICLE_TYPES.has(articleType) || TOPWEAR_ARTICLE_TYPES.has(subCategory)) {
    return true;
  }

  if (articleType.includes('top') || subCategory.includes('top')) {
    return true;
  }

  return false;
}

function findImageFileById(id) {
  const candidates = [`${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}.webp`];
  for (const candidate of candidates) {
    const fullPath = path.join(IMAGES_DIR, candidate);
    if (fs.existsSync(fullPath)) {
      return {
        fullPath,
        filename: candidate,
        ext: path.extname(candidate).toLowerCase() || '.jpg'
      };
    }
  }
  return null;
}

function toPublicObjectPath(filename) {
  return `catalog/${filename}`;
}

function encodeObjectPath(objectPath) {
  return objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function withoutTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildSupabasePublicUrl(objectPath) {
  const encodedPath = encodeObjectPath(objectPath);
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${encodedPath}`;
}

function buildPublicUrl(objectPath) {
  const encodedPath = encodeObjectPath(objectPath);
  if (PRODUCT_IMAGE_PUBLIC_BASE_URL) {
    return `${withoutTrailingSlash(PRODUCT_IMAGE_PUBLIC_BASE_URL)}/${encodedPath}`;
  }

  if (SUPABASE_URL && SUPABASE_STORAGE_BUCKET) {
    return buildSupabasePublicUrl(objectPath);
  }

  return '';
}

function getContentType(fileExtension) {
  switch (fileExtension) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpeg':
    case '.jpg':
    default:
      return 'image/jpeg';
  }
}

async function uploadImageToSupabase({ localPath, objectPath, contentType }) {
  if (PRODUCT_IMAGE_S3_UPLOAD_ENABLED) {
    await uploadImageToSupabaseS3({ localPath, objectPath, contentType });
    return;
  }

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${encodeObjectPath(objectPath)}`;
  const fileBuffer = await fs.promises.readFile(localPath);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_API_KEY}`,
      apikey: SUPABASE_API_KEY,
      'x-upsert': 'true',
      'Content-Type': contentType
    },
    body: fileBuffer
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase upload failed (${response.status}): ${body.slice(0, 180)}`);
  }
}

async function uploadImageToSupabaseS3({ localPath, objectPath, contentType }) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

  if (!s3Client) {
    s3Client = new S3Client({
      region: PRODUCT_IMAGE_S3_REGION,
      endpoint: PRODUCT_IMAGE_S3_ENDPOINT,
      forcePathStyle: PRODUCT_IMAGE_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: PRODUCT_IMAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY
      }
    });
  }

  const fileBuffer = await fs.promises.readFile(localPath);
  const command = new PutObjectCommand({
    Bucket: PRODUCT_IMAGE_S3_BUCKET,
    Key: objectPath,
    Body: fileBuffer,
    ContentType: contentType
  });

  await s3Client.send(command);
}

function toProductPayload({ row, sourceId, publicUrl }) {
  if (!publicUrl) {
    throw new Error('Missing product image public URL (set PRODUCT_IMAGE_PUBLIC_BASE_URL or use Supabase public storage)');
  }

  const articleType = String(row.articletype || '').trim();
  const subCategory = String(row.subcategory || '').trim();
  const baseColour = String(row.basecolour || '').trim();
  const season = String(row.season || '').trim();
  const usage = String(row.usage || '').trim();
  const year = Number.parseInt(String(row.year || '').trim(), 10);
  const displayName = String(row.productdisplayname || '').trim();
  const masterCategory = String(row.mastercategory || '').trim();
  const gender = String(row.gender || '').trim();

  const normalizedArticle = inferSubcategory(articleType, subCategory);
  const title = displayName || `${articleType || subCategory || 'Fashion Item'} ${sourceId}`;

  return {
    title,
    category: 'top',
    subcategory: normalizedArticle,
    gender: normalizeGender(gender),
    brand: 'Fashion Dataset',
    datasetName: FASHION_DATASET_NAME,
    datasetItemId: sourceId,
    masterCategory: masterCategory || null,
    articleType: articleType || null,
    baseColour: baseColour || null,
    season: season || null,
    usage: usage || null,
    releaseYear: Number.isFinite(year) ? year : null,
    source: FASHION_SOURCE,
    sourceId,
    license: 'Kaggle Dataset License',
    image: publicUrl,
    thumbnail: publicUrl,
    color: colorToHex(baseColour),
    metadata: {
      original: row
    },
    tags: [masterCategory, subCategory, articleType, baseColour, season, usage]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  };
}

async function importBatch(products) {
  if (!Array.isArray(products) || products.length === 0) {
    return 0;
  }

  if (!FASHION_IMPORT_METADATA) {
    return products.length;
  }

  const response = await fetch(`${CATALOG_API_URL}/api/clothes/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ clothes: products })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || `Catalog import failed (${response.status})`);
  }

  return Array.isArray(payload.imported) ? payload.imported.length : products.length;
}

function validateEnvironment() {
  if (!fs.existsSync(STYLES_CSV_PATH)) {
    throw new Error(`styles.csv not found at ${STYLES_CSV_PATH}`);
  }
  if (!fs.existsSync(IMAGES_DIR)) {
    throw new Error(`images directory not found at ${IMAGES_DIR}`);
  }

  if (FASHION_UPLOAD_IMAGES && !PRODUCT_IMAGE_S3_UPLOAD_ENABLED) {
    // REST uploads require Supabase Storage REST + API key.
    if (!SUPABASE_URL) {
      throw new Error('SUPABASE_URL is required when uploading images via Supabase Storage REST API');
    }
    if (!SUPABASE_API_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY is required when FASHION_UPLOAD_IMAGES=true (REST mode)');
    }
  }

  if (FASHION_IMPORT_METADATA) {
    const isSupabaseS3Endpoint = PRODUCT_IMAGE_S3_ENDPOINT.includes('supabase.co');
    const needsExplicitPublicBase =
      PRODUCT_IMAGE_S3_UPLOAD_ENABLED
      && (!isSupabaseS3Endpoint || PRODUCT_IMAGE_S3_BUCKET !== SUPABASE_STORAGE_BUCKET);

    if (needsExplicitPublicBase && !PRODUCT_IMAGE_PUBLIC_BASE_URL) {
      throw new Error('PRODUCT_IMAGE_PUBLIC_BASE_URL is required when uploading images to an external S3 bucket and importing metadata');
    }

    if (!PRODUCT_IMAGE_PUBLIC_BASE_URL && !SUPABASE_URL) {
      throw new Error('SUPABASE_URL is required to construct public image URLs (or set PRODUCT_IMAGE_PUBLIC_BASE_URL)');
    }
  }
}

async function main() {
  validateEnvironment();

  console.log('[fashion-import] starting Kaggle -> Supabase import');
  console.log(`[fashion-import] styles file: ${STYLES_CSV_PATH}`);
  console.log(`[fashion-import] images dir: ${IMAGES_DIR}`);
  console.log(`[fashion-import] source: ${FASHION_SOURCE}`);
  console.log(`[fashion-import] upload mode: ${PRODUCT_IMAGE_S3_UPLOAD_ENABLED ? 's3' : 'storage-rest'}`);
  if (PRODUCT_IMAGE_S3_UPLOAD_ENABLED) {
    console.log(`[fashion-import] image bucket: ${PRODUCT_IMAGE_S3_BUCKET}`);
  }
  console.log(`[fashion-import] metadata import: ${FASHION_IMPORT_METADATA ? 'enabled' : 'disabled'}`);

  const batch = [];
  let scanned = 0;
  let included = 0;
  let uploaded = 0;
  let skipped = 0;
  let imported = 0;

  for await (const row of iterateCsvRows(STYLES_CSV_PATH)) {
    scanned += 1;

    const sourceId = String(row.id || '').trim();
    if (!sourceId) {
      skipped += 1;
      continue;
    }

    if (FASHION_ONLY_TOPWEAR && !isTopwear(row)) {
      continue;
    }

    const image = findImageFileById(sourceId);
    if (!image) {
      skipped += 1;
      continue;
    }

    const objectPath = toPublicObjectPath(image.filename);
    const publicUrl = FASHION_IMPORT_METADATA ? buildPublicUrl(objectPath) : '';

    if (FASHION_UPLOAD_IMAGES) {
      await uploadImageToSupabase({
        localPath: image.fullPath,
        objectPath,
        contentType: getContentType(image.ext)
      });
      uploaded += 1;
    }

    if (FASHION_IMPORT_METADATA) {
      const product = toProductPayload({ row, sourceId, publicUrl });
      batch.push(product);
    } else {
      // Keep accounting consistent when metadata import is disabled.
      batch.push({});
    }
    included += 1;

    if (batch.length >= FASHION_BATCH_SIZE) {
      imported += await importBatch(batch.splice(0, batch.length));
      console.log(`[fashion-import] progress scanned=${scanned}, included=${included}, uploaded=${uploaded}, imported=${imported}`);
    }

    if (FASHION_MAX_ITEMS > 0 && included >= FASHION_MAX_ITEMS) {
      break;
    }
  }

  if (batch.length > 0) {
    imported += await importBatch(batch.splice(0, batch.length));
  }

  console.log('[fashion-import] complete');
  console.log(`[fashion-import] scanned=${scanned}`);
  console.log(`[fashion-import] included=${included}`);
  console.log(`[fashion-import] uploaded=${uploaded}`);
  console.log(`[fashion-import] imported=${imported}`);
  console.log(`[fashion-import] skipped=${skipped}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[fashion-import] failed:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  iterateCsvRows,
  toProductPayload,
  importBatch
};
