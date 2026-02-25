const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const DEFAULT_PREFIX = stripWrappingQuotes(process.env.CATALOG_S3_PREFIX || 'catalog/');
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const LOCAL_CATALOG_DIR = path.join(__dirname, '../../catalog');

function stripWrappingQuotes(value = '') {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function normalizeCatalogMode(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'auto';
  if (['auto', 'fallback', 'default'].includes(text)) return 'auto';
  if (['local', 'fs', 'filesystem', 'disk'].includes(text)) return 'local';
  if (['s3', 'tebi', 'bucket', 'remote'].includes(text)) return 's3';
  return 'auto';
}

function ensureUrlScheme(value = '') {
  const text = stripWrappingQuotes(value);
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text}`;
}

const PRODUCT_IMAGE_PUBLIC_BASE_URL = ensureUrlScheme(process.env.PRODUCT_IMAGE_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const CATALOG_PUBLIC_BASE_URL = ensureUrlScheme(process.env.CATALOG_PUBLIC_BASE_URL || PRODUCT_IMAGE_PUBLIC_BASE_URL || '')
  .replace(/\/+$/, '');

const SIGNED_URL_EXPIRES_SEC = Math.max(
  60,
  Number.parseInt(process.env.CATALOG_SIGNED_URL_EXPIRES_SEC || process.env.PRODUCT_IMAGE_S3_SIGNED_URL_EXPIRES_SEC || '3600', 10) || 3600
);

let s3Client = null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function encodeObjectKey(key = '') {
  return String(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function getExtension(key = '') {
  const trimmed = String(key || '');
  const dot = trimmed.lastIndexOf('.');
  if (dot === -1) return '';
  return trimmed.slice(dot).toLowerCase();
}

function looksLikeImageKey(key = '') {
  return IMAGE_EXTENSIONS.has(getExtension(key));
}

function isAppleDoubleFile(filename = '') {
  return String(filename || '').startsWith('._');
}

function humanizeStem(value = '') {
  return String(value || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function guessLocalSubcategory(stem = '') {
  const text = String(stem || '').toLowerCase();
  const rules = [
    ['hoodie', /\bhood/i],
    ['jacket', /\bjacket/i],
    ['cardigan', /\bcardig/i],
    ['sweater', /\bsweater/i],
    ['tshirt', /\bt-?shirts?\b|\btshirts?\b|\btee\b/i],
    ['turtleneck', /\bturtle/i],
    ['zip', /\bzip\b/i],
    ['shirt', /\bshirt\b/i]
  ];

  for (const [label, pattern] of rules) {
    if (pattern.test(text)) return label;
  }

  return 'catalog';
}

async function listLocalCatalogFilenames() {
  try {
    const entries = await fs.promises.readdir(LOCAL_CATALOG_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter(Boolean)
      .filter((name) => !isAppleDoubleFile(name))
      .filter((name) => looksLikeImageKey(name))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return [];
    }
    throw error;
  }
}

async function buildLocalCatalogItems({ limit, search } = {}) {
  const filenames = await listLocalCatalogFilenames();
  const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : '';
  const filtered = normalizedSearch
    ? filenames.filter((name) => name.toLowerCase().includes(normalizedSearch))
    : filenames;

  const slice = typeof limit === 'number' && Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;

  return slice.map((filename) => {
    const stem = filename.replace(/\.[^/.]+$/, '');
    const title = humanizeStem(stem);
    const encoded = encodeObjectKey(filename);
    return {
      id: `catalog/${filename}`,
      title,
      name: title,
      source: 'catalog',
      sourceId: `catalog/${filename}`,
      category: 'catalog',
      subcategory: guessLocalSubcategory(stem),
      imageUrl: `/catalog/${encoded}`,
      thumbnailUrl: `/catalog/${encoded}`
    };
  });
}

function getS3Config() {
  const bucket = process.env.PRODUCT_IMAGE_S3_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || '';
  const endpoint = process.env.PRODUCT_IMAGE_S3_ENDPOINT || process.env.SUPABASE_S3_ENDPOINT || '';
  const accessKeyId = process.env.PRODUCT_IMAGE_S3_ACCESS_KEY_ID || process.env.SUPABASE_S3_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY || process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '';
  const forcePathStyle = String(
    process.env.PRODUCT_IMAGE_S3_FORCE_PATH_STYLE ?? process.env.SUPABASE_S3_FORCE_PATH_STYLE ?? 'true'
  ).toLowerCase() !== 'false';

  const regionFallback = String(endpoint).includes('tebi.io') ? 'global' : 'us-east-1';
  const region = process.env.PRODUCT_IMAGE_S3_REGION || process.env.SUPABASE_S3_REGION || regionFallback;

  return {
    bucket: stripWrappingQuotes(bucket),
    endpoint: ensureUrlScheme(endpoint),
    accessKeyId: stripWrappingQuotes(accessKeyId),
    secretAccessKey: stripWrappingQuotes(secretAccessKey),
    region: stripWrappingQuotes(region),
    forcePathStyle
  };
}

function shouldSignUrls(config) {
  const explicit = stripWrappingQuotes(
    process.env.CATALOG_SIGNED_URLS || process.env.PRODUCT_IMAGE_S3_SIGNED_URLS || ''
  ).toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return Boolean(config.accessKeyId && config.secretAccessKey);
}

function getS3Client(config) {
  if (s3Client) return s3Client;

  if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
    return null;
  }

  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: config.region || 'us-east-1',
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  });
  return s3Client;
}

function buildPublicUrl(config, key) {
  const base = CATALOG_PUBLIC_BASE_URL || (config.endpoint && config.bucket ? `${config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}` : '');
  if (!base) return '';
  return `${base}/${encodeObjectKey(key)}`;
}

async function buildObjectUrl(config, key) {
  if (!key) return '';

  if (shouldSignUrls(config)) {
    const client = getS3Client(config);
    if (!client || !config.bucket) {
      return '';
    }
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: SIGNED_URL_EXPIRES_SEC }
    );
  }

  return buildPublicUrl(config, key);
}

function deriveSubcategory(prefix, key) {
  const safePrefix = String(prefix || '').trim();
  const rawKey = String(key || '');
  const remainder = safePrefix && rawKey.startsWith(safePrefix) ? rawKey.slice(safePrefix.length) : rawKey;
  const parts = remainder.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts[0].toLowerCase();
  }
  return 'catalog';
}

router.get('/health', async (req, res) => {
  const requestedMode = normalizeCatalogMode(req.query.mode || process.env.CATALOG_MODE || '');
  const config = getS3Config();
  const prefix = String(req.query.prefix || DEFAULT_PREFIX).trim();
  const configured = Boolean(config.bucket && config.endpoint);
  const credentialsConfigured = Boolean(config.accessKeyId && config.secretAccessKey);

  let localCount = 0;
  let localError = null;
  try {
    const filenames = await listLocalCatalogFilenames();
    localCount = filenames.length;
  } catch (error) {
    localError = error?.message || String(error);
  }

  const baseReport = {
    ok: false,
    mode: null,
    checkedAt: new Date().toISOString(),
    configured,
    credentialsConfigured,
    bucket: config.bucket || null,
    endpoint: config.endpoint || null,
    region: config.region || null,
    forcePathStyle: config.forcePathStyle,
    signedUrls: shouldSignUrls(config),
    publicBaseUrl: CATALOG_PUBLIC_BASE_URL || null,
    prefix,
    localCount,
    localError
  };

  const client = getS3Client(config);

  try {
    if (requestedMode !== 'local' && configured && client) {
      const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
      const response = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        MaxKeys: 1
      }));

      const sampleKeys = (response.Contents || [])
        .map((item) => item.Key)
        .filter(Boolean)
        .slice(0, 1);

      return res.json({
        ...baseReport,
        ok: true,
        mode: 's3',
        sampleKeys
      });
    }
  } catch (error) {
    // fall through to local fallback
    baseReport.s3Error = error?.message || String(error);
    baseReport.s3ErrorName = error?.name || null;
  }

  if (requestedMode === 's3') {
    const detail = baseReport.s3Error
      ? `Catalog S3 is unavailable: ${baseReport.s3Error}`
      : 'Catalog S3 is not configured';

    return res.json({
      ...baseReport,
      ok: false,
      mode: 's3',
      error: detail
    });
  }

  if (localCount > 0) {
    return res.json({
      ...baseReport,
      ok: true,
      mode: 'local'
    });
  }

  if (!configured) {
    return res.json({
      ...baseReport,
      error: 'Catalog is not configured (no S3 and no local catalog)',
      requiredEnv: [
        'PRODUCT_IMAGE_S3_BUCKET',
        'PRODUCT_IMAGE_S3_ENDPOINT',
        'PRODUCT_IMAGE_S3_ACCESS_KEY_ID',
        'PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY'
      ]
    });
  }

  if (!client) {
    return res.json({
      ...baseReport,
      error: 'Catalog S3 client is not configured and no local catalog is available',
      requiredEnv: [
        'PRODUCT_IMAGE_S3_ACCESS_KEY_ID',
        'PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY'
      ]
    });
  }

  return res.json({
    ...baseReport,
    error: 'Catalog is unavailable (S3 failed and local catalog empty)'
  });
});

router.get('/', async (req, res) => {
  try {
    const requestedMode = normalizeCatalogMode(req.query.mode || process.env.CATALOG_MODE || '');
    const config = getS3Config();
    const prefix = String(req.query.prefix || DEFAULT_PREFIX).trim();
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const continuationToken = typeof req.query.continuationToken === 'string' ? req.query.continuationToken : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    if (requestedMode === 'local') {
      const items = await buildLocalCatalogItems({ limit, search });
      return res.json({
        prefix,
        mode: 'local',
        items,
        nextContinuationToken: null
      });
    }

    const canTryS3 = Boolean(config.bucket && config.endpoint);
    const client = getS3Client(config);
    const canUseS3 = canTryS3 && Boolean(client);

    if (canUseS3) {
      try {
        const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
        const response = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: prefix,
          MaxKeys: limit,
          ContinuationToken: continuationToken
        }));

        const keys = (response.Contents || [])
          .map((item) => item.Key)
          .filter(Boolean)
          .filter((key) => !key.endsWith('/'))
          .filter((key) => looksLikeImageKey(key))
          .filter((key) => (search ? key.toLowerCase().includes(search) : true));

        const items = await Promise.all(keys.map(async (key) => {
          const file = key.split('/').pop() || key;
          const stem = file.replace(/\.[^/.]+$/, '');
          const title = humanizeStem(stem);
          const url = await buildObjectUrl(config, key);
          return {
            id: key,
            title,
            name: title,
            source: 'catalog',
            sourceId: key,
            category: 'catalog',
            subcategory: deriveSubcategory(prefix, key),
            imageUrl: url,
            thumbnailUrl: url
          };
        }));

        return res.json({
          prefix,
          mode: 's3',
          items,
          nextContinuationToken: response.NextContinuationToken || null
        });
      } catch (error) {
        if (requestedMode === 's3') {
          return res.status(502).json({
            prefix,
            mode: 's3',
            items: [],
            nextContinuationToken: null,
            error: 'Catalog S3 request failed',
            detail: error?.message || String(error)
          });
        }
        // fall back to local catalog below
        const fallbackItems = await buildLocalCatalogItems({ limit, search });
        return res.json({
          prefix,
          mode: 'local',
          items: fallbackItems,
          nextContinuationToken: null,
          s3Error: error?.message || String(error)
        });
      }
    }

    if (requestedMode === 's3') {
      return res.status(400).json({
        prefix,
        mode: 's3',
        items: [],
        nextContinuationToken: null,
        error: 'Catalog S3 client is not configured'
      });
    }

    const items = await buildLocalCatalogItems({ limit, search });
    return res.json({
      prefix,
      mode: 'local',
      items,
      nextContinuationToken: null
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to load catalog',
      detail: error.message || String(error)
    });
  }
});

module.exports = router;
