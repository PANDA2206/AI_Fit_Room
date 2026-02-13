const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../db/client');

const router = express.Router();

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSaltRounds(value, fallback = 10) {
  const parsed = parseInteger(value, fallback);
  return Math.max(4, Math.min(parsed, 15));
}

const SALT_ROUNDS = parseSaltRounds(process.env.PASSWORD_SALT_ROUNDS, 10);
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
const JWT_REFRESH_DAYS = Math.max(1, Math.min(parseInteger(process.env.JWT_REFRESH_DAYS, 30), 180));

function sanitizeUser(userRow) {
  if (!userRow) return null;
  return {
    id: userRow.id,
    email: userRow.email,
    username: userRow.username,
    displayName: userRow.display_name,
    role: userRow.role,
    isActive: userRow.is_active,
    createdAt: userRow.created_at,
    updatedAt: userRow.updated_at
  };
}

function issueAccessToken(user) {
  if (!JWT_SECRET) {
    return null;
  }
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function buildRefreshExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_DAYS);
  return expiresAt;
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashRefreshToken(refreshToken) {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function requireAuth(req, res, next) {
  if (!JWT_SECRET) {
    return res.status(500).json({
      error: 'JWT is not configured',
      detail: 'Set JWT_SECRET in environment to use authenticated endpoints.'
    });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function createRefreshSession({
  userId,
  userAgent = null,
  ipAddress = null
}) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = buildRefreshExpiryDate();

  await query(
    `INSERT INTO user_sessions (
      user_id, refresh_token_hash, user_agent, ip_address, expires_at
    ) VALUES ($1, $2, $3, $4::inet, $5)`,
    [
      userId,
      refreshTokenHash,
      userAgent,
      ipAddress,
      expiresAt.toISOString()
    ]
  );

  return {
    refreshToken,
    refreshTokenExpiresAt: expiresAt.toISOString()
  };
}

router.post('/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const usernameRaw = String(req.body?.username || '').trim();
  const displayNameRaw = String(req.body?.displayName || '').trim();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const username = usernameRaw || null;
  const displayName = displayNameRaw || null;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const ipAddress = getClientIp(req);

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const insertResult = await query(
      `INSERT INTO users (
        email, username, password_hash, display_name, role, is_active
      ) VALUES ($1, $2, $3, $4, 'customer', TRUE)
      RETURNING id, email, username, display_name, role, is_active, created_at, updated_at`,
      [email, username, passwordHash, displayName]
    );

    const userRow = insertResult.rows[0];
    const user = sanitizeUser(userRow);
    const accessToken = issueAccessToken(userRow);
    const refreshData = await createRefreshSession({
      userId: userRow.id,
      userAgent,
      ipAddress
    });

    return res.status(201).json({
      user,
      accessToken,
      refreshToken: refreshData.refreshToken,
      refreshTokenExpiresAt: refreshData.refreshTokenExpiresAt,
      authReady: Boolean(accessToken)
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'email or username already exists' });
    }
    return res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const ipAddress = getClientIp(req);

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const userResult = await query(
      `SELECT
         id, email, username, display_name, role, is_active,
         created_at, updated_at, password_hash
       FROM users
       WHERE email = $1`,
      [email]
    );

    const dbUser = userResult.rows[0];
    if (!dbUser || !dbUser.is_active) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const passwordOk = await bcrypt.compare(password, dbUser.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const refreshData = await createRefreshSession({
      userId: dbUser.id,
      userAgent,
      ipAddress
    });

    const accessToken = issueAccessToken(dbUser);
    return res.status(200).json({
      user: sanitizeUser(dbUser),
      accessToken,
      refreshToken: refreshData.refreshToken,
      refreshTokenExpiresAt: refreshData.refreshTokenExpiresAt,
      authReady: Boolean(accessToken)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/refresh', async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || '').trim();
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const ipAddress = getClientIp(req);

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  try {
    const refreshHash = hashRefreshToken(refreshToken);
    const sessionResult = await query(
      `SELECT
         s.id AS session_id,
         s.user_id,
         s.expires_at,
         s.revoked_at,
         u.id, u.email, u.username, u.display_name, u.role, u.is_active, u.created_at, u.updated_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1
       LIMIT 1`,
      [refreshHash]
    );

    const row = sessionResult.rows[0];
    if (!row) {
      return res.status(401).json({ error: 'invalid refresh token' });
    }

    if (row.revoked_at || !row.is_active || new Date(row.expires_at).getTime() <= Date.now()) {
      return res.status(401).json({ error: 'refresh token expired or revoked' });
    }

    const rotated = await withTransaction(async (client) => {
      await client.query(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
        [row.session_id]
      );

      const newRefreshToken = generateRefreshToken();
      const newRefreshHash = hashRefreshToken(newRefreshToken);
      const newExpires = buildRefreshExpiryDate();

      await client.query(
        `INSERT INTO user_sessions (
          user_id, refresh_token_hash, user_agent, ip_address, expires_at
        ) VALUES ($1, $2, $3, $4::inet, $5)`,
        [row.user_id, newRefreshHash, userAgent, ipAddress, newExpires.toISOString()]
      );

      return {
        refreshToken: newRefreshToken,
        refreshTokenExpiresAt: newExpires.toISOString()
      };
    });

    const userPayload = {
      id: row.id,
      email: row.email,
      role: row.role
    };

    return res.status(200).json({
      user: sanitizeUser(row),
      accessToken: issueAccessToken(userPayload),
      refreshToken: rotated.refreshToken,
      refreshTokenExpiresAt: rotated.refreshTokenExpiresAt
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/logout', async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || '').trim();
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  try {
    const refreshHash = hashRefreshToken(refreshToken);
    await query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE refresh_token_hash = $1
         AND revoked_at IS NULL`,
      [refreshHash]
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const userId = Number.parseInt(req.auth?.sub, 10);
  if (!Number.isFinite(userId)) {
    return res.status(401).json({ error: 'invalid token subject' });
  }

  try {
    const result = await query(
      `SELECT id, email, username, display_name, role, is_active, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'user not found' });
    }

    return res.status(200).json({ user: sanitizeUser(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/tryon-jobs', requireAuth, async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  const authUserId = Number.parseInt(req.auth?.sub, 10);
  const authRole = String(req.auth?.role || '').toLowerCase();
  const canView = authUserId === userId || authRole === 'admin' || authRole === 'staff';
  if (!canView) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = (page - 1) * limit;

  try {
    const [countResult, dataResult] = await Promise.all([
      query('SELECT COUNT(*)::int AS total FROM tryon_jobs WHERE user_id = $1', [userId]),
      query(
        `SELECT
           id, user_id AS "userId", product_id AS "productId",
           provider, provider_task_id AS "providerTaskId", status,
           model_image_url AS "modelImageUrl",
           top_garment_url AS "topGarmentUrl",
           bottom_garment_url AS "bottomGarmentUrl",
           output_image_urls AS "outputImageUrls",
           error_message AS "errorMessage",
           created_at AS "createdAt",
           updated_at AS "updatedAt",
           completed_at AS "completedAt"
         FROM tryon_jobs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      )
    ]);

    const total = countResult.rows[0]?.total || 0;
    return res.status(200).json({
      data: dataResult.rows,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
