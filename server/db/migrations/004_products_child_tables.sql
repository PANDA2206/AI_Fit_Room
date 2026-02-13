-- Child tables for richer product metadata from fashion dataset

CREATE TABLE IF NOT EXISTS fashion_images (
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  role          TEXT NOT NULL, -- e.g. default | front | back | search | size_representation
  url           TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  PRIMARY KEY (product_id, role, url)
);

CREATE TABLE IF NOT EXISTS fashion_sizes (
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku_id        TEXT NOT NULL,
  size_value    TEXT,
  available     BOOLEAN,
  seller_id     TEXT,
  seller_name   TEXT,
  PRIMARY KEY (product_id, sku_id)
);

CREATE TABLE IF NOT EXISTS fashion_flags (
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  value      TEXT,
  PRIMARY KEY (product_id, name)
);

CREATE INDEX IF NOT EXISTS idx_fashion_images_role ON fashion_images(role);
CREATE INDEX IF NOT EXISTS idx_fashion_sizes_available ON fashion_sizes(available);
CREATE INDEX IF NOT EXISTS idx_fashion_flags_name ON fashion_flags(name);
