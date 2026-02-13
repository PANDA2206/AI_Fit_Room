CREATE TABLE IF NOT EXISTS fashion_products_basic (
  product_id      BIGINT PRIMARY KEY,
  name            TEXT NOT NULL,
  title           TEXT NOT NULL,
  gender          TEXT,
  master_category TEXT,
  subcategory     TEXT,
  article_type    TEXT,
  base_colour     TEXT,
  color           TEXT,
  price           NUMERIC(10,2),
  currency        TEXT,
  brand           TEXT,
  image_url       TEXT,
  thumbnail_url   TEXT,
  source          TEXT,
  source_id       TEXT,
  dataset_name    TEXT,
  dataset_item_id TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
);

INSERT INTO fashion_products_basic (
  product_id, name, title, gender, master_category, subcategory, article_type,
  base_colour, color, price, currency, brand, image_url, thumbnail_url,
  source, source_id, dataset_name, dataset_item_id, created_at, updated_at
)
SELECT
  id, name, title, gender, master_category, subcategory, article_type,
  base_colour, color, price, currency, brand, image_url, thumbnail_url,
  source, source_id, dataset_name, dataset_item_id, created_at, updated_at
FROM products
WHERE source = 'fashion-product-images-kaggle'
ON CONFLICT (product_id) DO UPDATE SET
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  gender = EXCLUDED.gender,
  master_category = EXCLUDED.master_category,
  subcategory = EXCLUDED.subcategory,
  article_type = EXCLUDED.article_type,
  base_colour = EXCLUDED.base_colour,
  color = EXCLUDED.color,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  brand = EXCLUDED.brand,
  image_url = EXCLUDED.image_url,
  thumbnail_url = EXCLUDED.thumbnail_url,
  source = EXCLUDED.source,
  source_id = EXCLUDED.source_id,
  dataset_name = EXCLUDED.dataset_name,
  dataset_item_id = EXCLUDED.dataset_item_id,
  updated_at = EXCLUDED.updated_at;

CREATE INDEX IF NOT EXISTS idx_fpb_source_id ON fashion_products_basic(source, source_id);
