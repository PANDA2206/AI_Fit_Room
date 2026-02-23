const express = require('express');

const router = express.Router();

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const DEFAULT_PREFIX = String(process.env.CATALOG_S3_PREFIX || 'catalog/').trim();
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const PRODUCT_IMAGE_PUBLIC_BASE_URL = String(process.env.PRODUCT_IMAGE_PUBLIC_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const CATALOG_PUBLIC_BASE_URL = String(process.env.CATALOG_PUBLIC_BASE_URL || PRODUCT_IMAGE_PUBLIC_BASE_URL || '')
  .trim()
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

function humanizeStem(value = '') {
  return String(value || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getS3Config() {
  const bucket = process.env.PRODUCT_IMAGE_S3_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || '';
  const endpoint = process.env.PRODUCT_IMAGE_S3_ENDPOINT || process.env.SUPABASE_S3_ENDPOINT || '';
  const accessKeyId = process.env.PRODUCT_IMAGE_S3_ACCESS_KEY_ID || process.env.SUPABASE_S3_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY || process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '';
  const forcePathStyle = String(
    process.env.PRODUCT_IMAGE_S3_FORCE_PATH_STYLE ?? process.env.SUPABASE_S3_FORCE_PATH_STYLE ?? 'true'
  ).toLowerCase() !== 'false';

  const regionFallback = endpoint.includes('tebi.io') ? 'global' : 'us-east-1';
  const region = process.env.PRODUCT_IMAGE_S3_REGION || process.env.SUPABASE_S3_REGION || regionFallback;

  return {
    bucket: String(bucket).trim(),
    endpoint: String(endpoint).trim(),
    accessKeyId: String(accessKeyId).trim(),
    secretAccessKey: String(secretAccessKey).trim(),
    region: String(region).trim(),
    forcePathStyle
  };
}

function shouldSignUrls(config) {
  const explicit = String(process.env.CATALOG_SIGNED_URLS || process.env.PRODUCT_IMAGE_S3_SIGNED_URLS || '')
    .trim()
    .toLowerCase();
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

router.get('/', async (req, res) => {
  try {
    const config = getS3Config();
    if (!config.bucket || !config.endpoint) {
      return res.status(501).json({
        error: 'Catalog bucket is not configured',
        requiredEnv: [
          'PRODUCT_IMAGE_S3_BUCKET',
          'PRODUCT_IMAGE_S3_ENDPOINT',
          'PRODUCT_IMAGE_S3_ACCESS_KEY_ID',
          'PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY'
        ]
      });
    }

    const prefix = String(req.query.prefix || DEFAULT_PREFIX).trim();
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const continuationToken = typeof req.query.continuationToken === 'string' ? req.query.continuationToken : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    const client = getS3Client(config);
    if (!client) {
      return res.status(501).json({
        error: 'Catalog S3 client is not configured',
        requiredEnv: [
          'PRODUCT_IMAGE_S3_ACCESS_KEY_ID',
          'PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY'
        ]
      });
    }

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
      items,
      nextContinuationToken: response.NextContinuationToken || null
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to load catalog from bucket',
      detail: error.message || String(error)
    });
  }
});

module.exports = router;

