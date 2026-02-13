const express = require('express');
const crypto = require('crypto');
const { query, withTransaction } = require('../db/client');

const router = express.Router();

function parseProductIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    return { type: 'legacy', value: Number.parseInt(raw, 10) };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return { type: 'public', value: raw.toLowerCase() };
  }
  return null;
}

async function resolveProductInternalId(identifier) {
  const parsed = parseProductIdentifier(identifier);
  if (!parsed) {
    throw new Error('Invalid product identifier');
  }

  if (parsed.type === 'legacy') {
    return parsed.value;
  }

  const result = await query('SELECT id FROM products WHERE public_id = $1', [parsed.value]);
  if (result.rowCount === 0) {
    throw new Error('Product not found');
  }
  return result.rows[0].id;
}

function getOrGenerateGuestToken(req) {
  const fromHeader = String(req.headers['x-guest-token'] || req.query.guestToken || '').trim();
  if (fromHeader) return fromHeader;
  return crypto.randomUUID();
}

async function ensureCart(client, { guestToken }) {
  const existing = await client.query(
    `SELECT id FROM carts WHERE guest_token = $1 AND status = 'open' LIMIT 1`,
    [guestToken]
  );
  if (existing.rowCount > 0) {
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO carts (guest_token, status) VALUES ($1, 'open') RETURNING id`,
    [guestToken]
  );
  return inserted.rows[0].id;
}

async function loadCart(cartId) {
  const itemsResult = await query(
    `SELECT
       ci.product_id,
       ci.quantity,
       COALESCE(ci.unit_price, p.price, 0) AS unit_price,
       COALESCE(ci.currency, p.currency, 'INR') AS currency,
       p.public_id,
       COALESCE(NULLIF(p.title, ''), p.name) AS name,
       p.brand,
       p.category,
       p.subcategory,
       p.article_type,
       COALESCE(p.thumbnail_url, p.image_url) AS thumbnail_url,
       p.image_url
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1`,
    [cartId]
  );

  const items = itemsResult.rows.map((row) => ({
    id: row.public_id,
    productId: row.public_id,
    quantity: row.quantity,
    price: Number(row.unit_price) || 0,
    currency: row.currency || 'INR',
    name: row.name,
    brand: row.brand,
    category: row.category,
    subcategory: row.subcategory,
    articleType: row.article_type,
    image: row.image_url,
    thumbnail: row.thumbnail_url
  }));

  const subtotal = items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
  const currency = items[0]?.currency || 'INR';

  return {
    items,
    totals: {
      count: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
      subtotal,
      currency
    }
  };
}

router.get('/', async (req, res) => {
  const guestToken = getOrGenerateGuestToken(req);
  try {
    const cartId = await withTransaction((client) => ensureCart(client, { guestToken }));
    const payload = await loadCart(cartId);
    return res.status(200).json({ guestToken, cartId, ...payload });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/items', async (req, res) => {
  const guestToken = getOrGenerateGuestToken(req);
  const { productId, quantity = 1 } = req.body || {};
  const safeQty = Math.max(1, Number.parseInt(quantity, 10) || 1);

  try {
    const cartId = await withTransaction(async (client) => {
      const cid = await ensureCart(client, { guestToken });
      const internalProductId = await resolveProductInternalId(productId);

      const productResult = await client.query(
        `SELECT price, currency FROM products WHERE id = $1`,
        [internalProductId]
      );
      const product = productResult.rows[0] || {};

      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, currency)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cart_id, product_id)
         DO UPDATE SET
           quantity = EXCLUDED.quantity,
           unit_price = EXCLUDED.unit_price,
           currency = EXCLUDED.currency,
           added_at = NOW()`,
        [cid, internalProductId, safeQty, product.price || 0, product.currency || 'INR']
      );

      return cid;
    });

    const payload = await loadCart(cartId);
    return res.status(200).json({ guestToken, cartId, ...payload });
  } catch (error) {
    const status = String(error.message || '').includes('not found') ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
});

router.put('/items/:productId', async (req, res) => {
  const guestToken = getOrGenerateGuestToken(req);
  const { productId } = req.params;
  const { quantity = 1 } = req.body || {};
  const safeQty = Math.max(1, Number.parseInt(quantity, 10) || 1);

  try {
    const cartId = await withTransaction(async (client) => {
      const cid = await ensureCart(client, { guestToken });
      const internalProductId = await resolveProductInternalId(productId);

      await client.query(
        `UPDATE cart_items
         SET quantity = $1, added_at = NOW()
         WHERE cart_id = $2 AND product_id = $3`,
        [safeQty, cid, internalProductId]
      );

      return cid;
    });

    const payload = await loadCart(cartId);
    return res.status(200).json({ guestToken, cartId, ...payload });
  } catch (error) {
    const status = String(error.message || '').includes('not found') ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
});

router.delete('/items/:productId', async (req, res) => {
  const guestToken = getOrGenerateGuestToken(req);
  const { productId } = req.params;

  try {
    const cartId = await withTransaction(async (client) => {
      const cid = await ensureCart(client, { guestToken });
      const internalProductId = await resolveProductInternalId(productId);

      await client.query(
        `DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
        [cid, internalProductId]
      );

      return cid;
    });

    const payload = await loadCart(cartId);
    return res.status(200).json({ guestToken, cartId, ...payload });
  } catch (error) {
    const status = String(error.message || '').includes('not found') ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
});

router.post('/clear', async (req, res) => {
  const guestToken = getOrGenerateGuestToken(req);
  try {
    const cartId = await withTransaction(async (client) => {
      const cid = await ensureCart(client, { guestToken });
      await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cid]);
      return cid;
    });

    const payload = await loadCart(cartId);
    return res.status(200).json({ guestToken, cartId, ...payload });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
