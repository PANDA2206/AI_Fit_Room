ALTER TABLE products
  ADD COLUMN IF NOT EXISTS dataset_name TEXT,
  ADD COLUMN IF NOT EXISTS dataset_item_id TEXT,
  ADD COLUMN IF NOT EXISTS master_category TEXT,
  ADD COLUMN IF NOT EXISTS article_type TEXT,
  ADD COLUMN IF NOT EXISTS base_colour TEXT,
  ADD COLUMN IF NOT EXISTS season TEXT,
  ADD COLUMN IF NOT EXISTS usage TEXT,
  ADD COLUMN IF NOT EXISTS release_year INTEGER;

-- Remove old non-fashion seeded catalog rows.
DELETE FROM products
WHERE source IN ('pexels', 'catalog');

ALTER TABLE products
  ALTER COLUMN source SET DEFAULT 'fashion-product-images-kaggle',
  ALTER COLUMN license SET DEFAULT 'Kaggle Dataset License';

CREATE INDEX IF NOT EXISTS idx_products_master_category ON products(master_category);
CREATE INDEX IF NOT EXISTS idx_products_article_type ON products(article_type);
CREATE INDEX IF NOT EXISTS idx_products_base_colour ON products(base_colour);
CREATE INDEX IF NOT EXISTS idx_products_season ON products(season);
CREATE INDEX IF NOT EXISTS idx_products_usage ON products(usage);
CREATE INDEX IF NOT EXISTS idx_products_dataset_item_id ON products(dataset_item_id);
