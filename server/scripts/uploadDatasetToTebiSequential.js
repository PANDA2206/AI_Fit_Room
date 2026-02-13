require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DATASET_DIR = process.env.FASHION_DATASET_DIR || path.join(process.cwd(), 'data/fashion-product-images-dataset');
const IMAGES_DIR = process.env.FASHION_IMAGES_DIR || path.join(DATASET_DIR, 'images');
const BUCKET = process.env.PRODUCT_IMAGE_S3_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'product';
const ENDPOINT = process.env.PRODUCT_IMAGE_S3_ENDPOINT || process.env.SUPABASE_S3_ENDPOINT || '';
const REGION = process.env.PRODUCT_IMAGE_S3_REGION || process.env.SUPABASE_S3_REGION || 'us-east-1';
const ACCESS_KEY_ID = process.env.PRODUCT_IMAGE_S3_ACCESS_KEY_ID || process.env.SUPABASE_S3_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY || process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '';
const FORCE_PATH_STYLE = String(process.env.PRODUCT_IMAGE_S3_FORCE_PATH_STYLE || process.env.SUPABASE_S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false';

// Controls
const START_INDEX = Number.parseInt(process.env.UPLOAD_START_INDEX || '0', 10) || 0;
const MAX_ITEMS = Number.parseInt(process.env.UPLOAD_MAX_ITEMS || '0', 10); // 0 means all

function toObjectPath(filename) {
  return `catalog/${filename}`;
}

function isImage(filename) {
  return /\.(jpe?g|png|webp)$/i.test(filename);
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

  if (!fs.existsSync(IMAGES_DIR)) {
    throw new Error(`Images dir not found: ${IMAGES_DIR}`);
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

  const files = (await fs.promises.readdir(IMAGES_DIR)).filter(isImage).sort();
  const slice = MAX_ITEMS > 0 ? files.slice(START_INDEX, START_INDEX + MAX_ITEMS) : files.slice(START_INDEX);

  console.log(`[tebi-upload] starting sequential upload`);
  console.log(`[tebi-upload] bucket=${BUCKET} endpoint=${ENDPOINT}`);
  console.log(`[tebi-upload] items=${slice.length} startIndex=${START_INDEX} forcePathStyle=${FORCE_PATH_STYLE}`);

  let uploaded = 0;
  for (const filename of slice) {
    const localPath = path.join(IMAGES_DIR, filename);
    const objectPath = toObjectPath(filename);

    const buffer = await fs.promises.readFile(localPath);
    const contentType = filename.toLowerCase().endsWith('.png')
      ? 'image/png'
      : filename.toLowerCase().endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';

    try {
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectPath,
        ContentType: contentType,
        ContentLength: buffer.length
      });

      const signedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

      const response = await fetch(signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString()
        },
        body: buffer
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.error('[tebi-upload] upload failed', objectPath, err?.message || err);
      if (err?.$metadata) console.error('[tebi-upload] metadata', err.$metadata);
      try {
        console.error('[tebi-upload] full error', JSON.stringify(err, null, 2));
      } catch (_) {
        console.error('[tebi-upload] full error (non-serializable)', err);
      }
      console.error('[tebi-upload] keys', Object.keys(err || {}));
      console.error('[tebi-upload] name', err?.name);
      console.error('[tebi-upload] stack', err?.stack);
      console.dir(err, { depth: 5 });
      process.exit(1);
    }

    await fs.promises.unlink(localPath);
    uploaded += 1;
    if (uploaded % 25 === 0 || uploaded === slice.length) {
      console.log(`[tebi-upload] progress uploaded=${uploaded}/${slice.length} last=${objectPath}`);
    }
  }

  console.log(`[tebi-upload] complete uploaded=${uploaded}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[tebi-upload] failed:', err.message || err);
    process.exit(1);
  });
}
