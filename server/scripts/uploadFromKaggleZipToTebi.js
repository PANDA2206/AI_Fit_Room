// Stream product images directly from a KaggleHub zip archive into an S3-compatible bucket (e.g., Tebi)
// without writing extracted files to disk. This is useful when disk space is tight.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Defaults mirror existing uploader envs; override via env vars if needed.
const BUCKET = process.env.PRODUCT_IMAGE_S3_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'product';
const ENDPOINT = process.env.PRODUCT_IMAGE_S3_ENDPOINT || process.env.SUPABASE_S3_ENDPOINT || '';
const REGION = process.env.PRODUCT_IMAGE_S3_REGION || process.env.SUPABASE_S3_REGION || 'us-east-1';
const ACCESS_KEY_ID = process.env.PRODUCT_IMAGE_S3_ACCESS_KEY_ID || process.env.SUPABASE_S3_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY || process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '';
const FORCE_PATH_STYLE = String(process.env.PRODUCT_IMAGE_S3_FORCE_PATH_STYLE || process.env.SUPABASE_S3_FORCE_PATH_STYLE || 'false')
  .toLowerCase() !== 'false';

// Path to the KaggleHub archive (.zip) downloaded earlier.
// The default matches the cache layout used by downloadFashionDatasetFromKaggleHub.py.
const ARCHIVE_PATH = process.env.KAGGLE_ARCHIVE_PATH
  || path.join(process.cwd(), 'data/kagglehub-cache/datasets/paramaggarwal/fashion-product-images-dataset/1.archive');

function contentTypeFor(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function main() {
  requireEnv(ENDPOINT, 'PRODUCT_IMAGE_S3_ENDPOINT');
  requireEnv(ACCESS_KEY_ID, 'PRODUCT_IMAGE_S3_ACCESS_KEY_ID');
  requireEnv(SECRET_ACCESS_KEY, 'PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY');

  if (!fs.existsSync(ARCHIVE_PATH)) {
    throw new Error(`Archive not found at ${ARCHIVE_PATH}`);
  }

  const s3 = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY
    }
  });

  const archiveStream = fs.createReadStream(ARCHIVE_PATH).pipe(unzipper.Parse({ forceStream: true }));

  let uploaded = 0;
  for await (const entry of archiveStream) {
    if (entry.type !== 'File') {
      entry.autodrain();
      continue;
    }

    // We only care about image files; dataset paths look like "fashion-dataset/fashion-dataset/images/12345.jpg".
    if (!entry.path.includes('/images/')) {
      entry.autodrain();
      continue;
    }

    const filename = path.basename(entry.path);
    const key = `catalog/${filename}`;
    const contentType = contentTypeFor(filename);

    try {
      const buffer = await entry.buffer();
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length
      }));
    } catch (err) {
      entry.autodrain();
      console.error('[zip-upload] failed', key, err?.message || err);
      throw err;
    }

    uploaded += 1;
    if (uploaded <= 5 || uploaded % 500 === 0) {
      console.log(`[zip-upload] progress uploaded=${uploaded} last=${key}`);
    }
  }

  console.log(`[zip-upload] complete uploaded=${uploaded}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[zip-upload] error:', err?.message || err);
    process.exit(1);
  });
}
