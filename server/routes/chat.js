const express = require('express');

const router = express.Router();

const DEFAULT_RAG_HOST = process.env.NODE_ENV === 'production'
  ? 'https://ai-fit-room-9jfn.onrender.com'
  : 'http://localhost:8000';

const RAG_HOST = (process.env.RAG_HOST || process.env.RAG_URL || DEFAULT_RAG_HOST).replace(/\/$/, '');
const RAG_TIMEOUT_MS = Number.parseInt(process.env.RAG_TIMEOUT_MS || '25000', 10);

async function callRag(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

  try {
    const response = await fetch(`${RAG_HOST}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_err) {
        data = { detail: text };
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: data || { detail: `RAG service error (${response.status})` }
      };
    }

    return { ok: true, status: response.status, data };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        data: { error: `RAG request timed out after ${RAG_TIMEOUT_MS}ms` }
      };
    }

    return {
      ok: false,
      status: 503,
      data: {
        error: 'RAG service is unavailable',
        detail: error.message,
        ragHost: RAG_HOST
      }
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

router.get('/health', async (_req, res) => {
  const result = await callRag('/health');
  res.status(result.status).json(result.data);
});

router.post('/ingest-crawled', async (_req, res) => {
  const result = await callRag('/ingest-crawled', { method: 'POST' });
  res.status(result.status).json(result.data);
});

router.post('/', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  const limit = Number.isInteger(req.body?.limit) ? req.body.limit : 5;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const result = await callRag('/chat', {
    method: 'POST',
    body: {
      query,
      limit: Math.max(1, Math.min(limit, 10))
    }
  });

  return res.status(result.status).json(result.data);
});

module.exports = router;
