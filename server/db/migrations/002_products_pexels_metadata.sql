ALTER TABLE products
  ADD COLUMN IF NOT EXISTS public_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS photographer TEXT,
  ADD COLUMN IF NOT EXISTS license TEXT;

UPDATE products
SET public_id = gen_random_uuid()
WHERE public_id IS NULL;

UPDATE products
SET title = COALESCE(NULLIF(title, ''), name)
WHERE title IS NULL OR BTRIM(title) = '';

UPDATE products
SET source_id = external_id
WHERE source_id IS NULL AND external_id IS NOT NULL;

UPDATE products
SET source_id = CONCAT(source, '-', id)
WHERE source_id IS NULL OR BTRIM(source_id) = '';

UPDATE products
SET license = 'Catalog License'
WHERE license IS NULL OR BTRIM(license) = '';

ALTER TABLE products
  ALTER COLUMN public_id SET NOT NULL,
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'catalog',
  ALTER COLUMN license SET DEFAULT 'Catalog License';

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_public_id ON products(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_source_source_id ON products(source, source_id);
CREATE INDEX IF NOT EXISTS idx_products_title ON products(title);
CREATE INDEX IF NOT EXISTS idx_products_source_id ON products(source_id);
