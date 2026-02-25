const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const clothesRoutes = require('./routes/clothes');
const catalogRoutes = require('./routes/catalog');
const ragRoutes = require('./routes/rag');
const chatRoutes = require('./routes/chat');
const aiLabTryOnRoutes = require('./routes/aiLabTryOn');
const sizeEstimationRoutes = require('./routes/sizeEstimation');
const usersRoutes = require('./routes/users');
const cartRoutes = require('./routes/cart');
const { bootstrapDatabase } = require('./db/bootstrap');
const { closePool } = require('./db/client');

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

function normalizeOrigin(value = '') {
  const raw = stripWrappingQuotes(value);
  if (!raw) return '';
  if (raw === '*') return '*';

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch (_error) {
    return withScheme.replace(/\/+$/, '');
  }
}

function parseCorsRules(clientUrlEnv = '') {
  const raw = String(clientUrlEnv || '').trim();
  const tokens = raw
    .split(',')
    .map((value) => stripWrappingQuotes(value).trim())
    .filter(Boolean);

  const exactOrigins = new Set();
  const wildcardHosts = [];

  let allowAll = tokens.length === 0;

  for (const token of tokens) {
    if (token === '*') {
      allowAll = true;
      continue;
    }

    const wildcardMatch = token.match(/^(https?:\/\/)?\*\.(.+)$/i);
    if (wildcardMatch) {
      const protocol = wildcardMatch[1] ? wildcardMatch[1].toLowerCase().replace(/\/+$/, '') : null;
      wildcardHosts.push({
        protocol,
        suffix: wildcardMatch[2].toLowerCase()
      });
      continue;
    }

    const normalized = normalizeOrigin(token);
    if (normalized && normalized !== '*') {
      exactOrigins.add(normalized);
    }
  }

  return {
    allowAll,
    exactOrigins: [...exactOrigins],
    wildcardHosts
  };
}

function buildCorsOrigin(corsRules) {
  if (!corsRules || corsRules.allowAll) {
    return true;
  }

  const exactOrigins = Array.isArray(corsRules.exactOrigins) ? corsRules.exactOrigins : [];
  const wildcardHosts = Array.isArray(corsRules.wildcardHosts) ? corsRules.wildcardHosts : [];

  if (wildcardHosts.length === 0) {
    return exactOrigins.length === 0 ? true : exactOrigins;
  }

  const exactSet = new Set(exactOrigins);

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (exactSet.has(origin)) {
      callback(null, true);
      return;
    }

    try {
      const url = new URL(origin);
      const host = url.hostname.toLowerCase();

      const matchesWildcard = wildcardHosts.some((rule) => {
        if (!rule || !rule.suffix) return false;
        if (rule.protocol && url.protocol !== rule.protocol) return false;
        return host === rule.suffix || host.endsWith(`.${rule.suffix}`);
      });

      callback(null, matchesWildcard);
    } catch (_error) {
      callback(null, false);
    }
  };
}

const app = express();
const server = http.createServer(app);
const rawClientUrl = process.env.CLIENT_URL || '';
const corsRules = parseCorsRules(rawClientUrl);
const corsOrigin = buildCorsOrigin(corsRules);

const io = socketIo(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/clothes', express.static(path.join(__dirname, '../clothes')));
app.use('/catalog', express.static(path.join(__dirname, '../catalog')));

// Friendly root message so cloud deployments show a live indicator instead of 404
app.get('/', (req, res) => {
  res.send('AI Fit Room backend is live. See /api/health for status.');
});

// Routes
app.get('/api/health', (req, res) => {
  const wildcardOrigins = (corsRules.wildcardHosts || []).map((rule) => {
    if (!rule || !rule.suffix) return null;
    if (rule.protocol) {
      return `${rule.protocol}//*.${rule.suffix}`;
    }
    return `*.${rule.suffix}`;
  }).filter(Boolean);

  res.json({
    status: 'OK',
    message: 'Server is running',
    checkedAt: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || null,
    render: {
      serviceName: process.env.RENDER_SERVICE_NAME || null,
      externalUrl: process.env.RENDER_EXTERNAL_URL || null,
      gitBranch: process.env.RENDER_GIT_BRANCH || null,
      gitCommit: process.env.RENDER_GIT_COMMIT || null
    },
    cors: {
      clientUrlEnv: rawClientUrl ? String(rawClientUrl) : null,
      allowedOrigins: corsRules.allowAll
        ? ['*']
        : [...(corsRules.exactOrigins || []), ...wildcardOrigins]
    }
  });
});

// Clothes API routes
app.use('/api/clothes', clothesRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/rag', ragRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tryon/ailab', aiLabTryOnRoutes);
app.use('/api/size-estimation', sizeEstimationRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/auth', usersRoutes);
app.use('/api/cart', cartRoutes);

// Optional segmentation routes (tfjs-node is heavy and not installed by default).
if (String(process.env.ENABLE_SEGMENTATION || 'false').toLowerCase() === 'true') {
  try {
    // eslint-disable-next-line global-require
    const segmentRoutes = require('./routes/segment');
    app.use('/api/segment', segmentRoutes);
  } catch (error) {
    console.warn('[segment] routes disabled:', error.message || error);
  }
}

// Socket.IO for real-time communication
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Receive video frame from client
  socket.on('video-frame', (data) => {
    // Process the frame (you can add body detection here)
    // For now, just echo it back
    socket.emit('processed-frame', {
      frame: data.frame,
      timestamp: Date.now()
    });
  });

  // Handle cloth selection
  socket.on('cloth-selected', (data) => {
    console.log('Cloth selected:', data);
    socket.emit('cloth-applied', {
      clothId: data.clothId,
      success: true
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;

let isShuttingDown = false;

async function startServer() {
  try {
    await bootstrapDatabase();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`${signal} received, shutting down...`);

  server.close(async () => {
    try {
      await closePool();
    } catch (error) {
      console.error('Error while closing DB pool:', error);
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.error('Force shutdown due to timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
