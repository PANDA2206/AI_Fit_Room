const express = require('express');
const { query } = require('../db/client');

const router = express.Router();

const AILAB_API_BASE = (process.env.AILAB_API_BASE || 'https://www.ailabapi.com').replace(/\/$/, '');
const AILAB_API_KEY = process.env.AILAB_API_KEY || '';
const AILAB_TIMEOUT_MS = Number.parseInt(process.env.AILAB_TIMEOUT_MS || '60000', 10);

const SUBMIT_ENDPOINT = '/api/portrait/editing/try-on-clothes-pro';
const QUERY_ENDPOINT = '/api/common/query-async-task-result';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAbortController() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AILAB_TIMEOUT_MS);
  return { controller, timeoutId };
}

function parseJsonOrThrow(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`Invalid JSON response from AILab API: ${text?.slice(0, 200) || 'empty response'}`);
  }
}

function normalizeStatus(payload) {
  const raw = payload?.data?.status ?? payload?.status ?? payload?.data?.task_status;
  if (typeof raw === 'number') {
    if (raw === 1) return 'done';
    if (raw === 2) return 'failed';
    if (raw === 0) return 'processing';
  }
  const text = String(raw || '').toLowerCase();
  if (text.includes('success') || text.includes('done') || text.includes('finish')) return 'done';
  if (text.includes('fail') || text.includes('error')) return 'failed';
  if (text.includes('process') || text.includes('queue') || text.includes('pending')) return 'processing';
  return 'unknown';
}

function extractImageUrls(payload) {
  const urls = [];
  const add = (value) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      urls.push(value);
    }
  };
  const walk = (node) => {
    if (!node) return;
    if (typeof node === 'string') {
      add(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };
  walk(payload?.data);
  walk(payload?.result);
  return [...new Set(urls)];
}

function toNullableBigInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function upsertTryOnJob({
  providerTaskId,
  userId = null,
  productId = null,
  status = 'submitted',
  modelImageUrl = null,
  topGarmentUrl = null,
  bottomGarmentUrl = null,
  outputImageUrls = [],
  requestPayload = {},
  responsePayload = {},
  errorMessage = null
}) {
  if (!providerTaskId) {
    return;
  }

  const finalStatus = String(status || 'submitted').toLowerCase();
  const completedAt = ['done', 'failed', 'timeout', 'error'].includes(finalStatus) ? new Date().toISOString() : null;

  await query(
    `INSERT INTO tryon_jobs (
      user_id,
      product_id,
      provider,
      provider_task_id,
      status,
      model_image_url,
      top_garment_url,
      bottom_garment_url,
      output_image_urls,
      request_payload,
      response_payload,
      error_message,
      completed_at
    ) VALUES (
      $1, $2, 'ailab', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12
    )
    ON CONFLICT (provider_task_id)
    DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, tryon_jobs.user_id),
      product_id = COALESCE(EXCLUDED.product_id, tryon_jobs.product_id),
      status = EXCLUDED.status,
      model_image_url = COALESCE(EXCLUDED.model_image_url, tryon_jobs.model_image_url),
      top_garment_url = COALESCE(EXCLUDED.top_garment_url, tryon_jobs.top_garment_url),
      bottom_garment_url = COALESCE(EXCLUDED.bottom_garment_url, tryon_jobs.bottom_garment_url),
      output_image_urls = EXCLUDED.output_image_urls,
      request_payload = CASE
        WHEN EXCLUDED.request_payload::text = '{}' THEN tryon_jobs.request_payload
        ELSE EXCLUDED.request_payload
      END,
      response_payload = CASE
        WHEN EXCLUDED.response_payload::text = '{}' THEN tryon_jobs.response_payload
        ELSE EXCLUDED.response_payload
      END,
      error_message = COALESCE(EXCLUDED.error_message, tryon_jobs.error_message),
      completed_at = COALESCE(EXCLUDED.completed_at, tryon_jobs.completed_at),
      updated_at = NOW()`,
    [
      toNullableBigInt(userId),
      toNullableBigInt(productId),
      providerTaskId,
      finalStatus,
      modelImageUrl,
      topGarmentUrl,
      bottomGarmentUrl,
      JSON.stringify(Array.isArray(outputImageUrls) ? outputImageUrls : []),
      JSON.stringify(requestPayload || {}),
      JSON.stringify(responsePayload || {}),
      errorMessage,
      completedAt
    ]
  );
}

async function fetchImageBlob(imageUrl, label) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error(`Missing ${label} URL`);
  }
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch (_error) {
    throw new Error(`Invalid ${label} URL: ${imageUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported ${label} protocol: ${parsed.protocol}`);
  }

  const { controller, timeoutId } = buildAbortController();
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${label} image (${response.status})`);
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      throw new Error(`${label} URL did not return an image`);
    }
    const imageArrayBuffer = await response.arrayBuffer();
    const filename = parsed.pathname.split('/').pop() || `${label}.jpg`;
    const blob = new Blob([imageArrayBuffer], { type: contentType });
    return { blob, filename };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callAiLab(path, { method = 'GET', body } = {}) {
  if (!AILAB_API_KEY) {
    return {
      ok: false,
      status: 400,
      payload: {
        error: 'AILAB_API_KEY is not configured',
        detail: 'Set AILAB_API_KEY in environment (.env/.env.prod) before calling this endpoint.'
      }
    };
  }

  const { controller, timeoutId } = buildAbortController();
  try {
    const response = await fetch(`${AILAB_API_BASE}${path}`, {
      method,
      headers: {
        'ailabapi-api-key': AILAB_API_KEY
      },
      body,
      signal: controller.signal
    });

    const text = await response.text();
    const payload = parseJsonOrThrow(text);
    const errorCode = Number.parseInt(payload?.error_code ?? '0', 10);
    const isLogicalError = Number.isFinite(errorCode) && errorCode !== 0;

    if (!response.ok || isLogicalError) {
      return {
        ok: false,
        status: response.ok ? 400 : response.status,
        payload: {
          error: payload?.error_msg || payload?.message || `AILab API error (${response.status})`,
          errorCode: Number.isFinite(errorCode) ? errorCode : undefined,
          raw: payload
        }
      };
    }

    return { ok: true, status: response.status, payload };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        payload: {
          error: `AILab request timed out after ${AILAB_TIMEOUT_MS}ms`
        }
      };
    }
    return {
      ok: false,
      status: 503,
      payload: {
        error: 'AILab service is unavailable',
        detail: error.message
      }
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function submitTryOnTask({
  modelImageUrl,
  topGarmentUrl,
  bottomGarmentUrl,
  resolution = -1,
  restoreFace = true
}) {
  if (!modelImageUrl || (!topGarmentUrl && !bottomGarmentUrl)) {
    return {
      ok: false,
      status: 400,
      payload: {
        error: 'modelImageUrl and at least one garment image are required'
      }
    };
  }

  const formData = new FormData();
  const modelImage = await fetchImageBlob(modelImageUrl, 'model');
  formData.append('model_image', modelImage.blob, modelImage.filename);

  if (topGarmentUrl) {
    const topImage = await fetchImageBlob(topGarmentUrl, 'top garment');
    formData.append('top_garment', topImage.blob, topImage.filename);
  }

  if (bottomGarmentUrl) {
    const bottomImage = await fetchImageBlob(bottomGarmentUrl, 'bottom garment');
    formData.append('bottom_garment', bottomImage.blob, bottomImage.filename);
  }

  formData.append('restore_face', String(Boolean(restoreFace)));
  formData.append('resolution', String(Number.isFinite(Number(resolution)) ? Number(resolution) : -1));

  return callAiLab(SUBMIT_ENDPOINT, {
    method: 'POST',
    body: formData
  });
}

async function queryTryOnTask(taskId) {
  if (!taskId) {
    return {
      ok: false,
      status: 400,
      payload: { error: 'taskId is required' }
    };
  }
  const encodedTaskId = encodeURIComponent(taskId);
  return callAiLab(`${QUERY_ENDPOINT}?task_id=${encodedTaskId}`);
}

router.post('/submit', async (req, res) => {
  const {
    userId = null,
    productId = null,
    modelImageUrl,
    topGarmentUrl,
    bottomGarmentUrl,
    resolution = -1,
    restoreFace = true
  } = req.body || {};

  try {
    const submitResponse = await submitTryOnTask({
      modelImageUrl,
      topGarmentUrl,
      bottomGarmentUrl,
      resolution,
      restoreFace
    });
    if (!submitResponse.ok) {
      return res.status(submitResponse.status).json(submitResponse.payload);
    }

    const taskId = submitResponse.payload?.data?.task_id || submitResponse.payload?.task_id;
    if (!taskId) {
      return res.status(502).json({
        error: 'AILab did not return a task id',
        raw: submitResponse.payload
      });
    }

    await upsertTryOnJob({
      providerTaskId: taskId,
      userId,
      productId,
      status: 'submitted',
      modelImageUrl,
      topGarmentUrl: topGarmentUrl || null,
      bottomGarmentUrl: bottomGarmentUrl || null,
      requestPayload: {
        modelImageUrl,
        topGarmentUrl,
        bottomGarmentUrl,
        resolution,
        restoreFace
      },
      responsePayload: submitResponse.payload
    });

    return res.status(200).json({
      taskId,
      status: 'submitted',
      raw: submitResponse.payload
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to submit try-on task',
      detail: error.message
    });
  }
});

router.get('/result', async (req, res) => {
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId.trim() : '';
  const resultResponse = await queryTryOnTask(taskId);

  if (!resultResponse.ok) {
    return res.status(resultResponse.status).json(resultResponse.payload);
  }

  const status = normalizeStatus(resultResponse.payload);
  const imageUrls = extractImageUrls(resultResponse.payload);

  await upsertTryOnJob({
    providerTaskId: taskId,
    status,
    outputImageUrls: imageUrls,
    responsePayload: resultResponse.payload,
    errorMessage: status === 'failed' ? resultResponse.payload?.error_msg || resultResponse.payload?.message || 'Try-on failed' : null
  });

  return res.status(200).json({
    taskId,
    status,
    imageUrls,
    raw: resultResponse.payload
  });
});

router.post('/generate', async (req, res) => {
  const {
    userId = null,
    productId = null,
    modelImageUrl,
    topGarmentUrl,
    bottomGarmentUrl,
    resolution = -1,
    restoreFace = true,
    pollIntervalMs = 2500,
    maxWaitMs = 90000
  } = req.body || {};

  try {
    const submitResponse = await submitTryOnTask({
      modelImageUrl,
      topGarmentUrl,
      bottomGarmentUrl,
      resolution,
      restoreFace
    });
    if (!submitResponse.ok) {
      return res.status(submitResponse.status).json(submitResponse.payload);
    }

    const taskId = submitResponse.payload?.data?.task_id || submitResponse.payload?.task_id;
    if (!taskId) {
      return res.status(502).json({
        error: 'AILab did not return a task id',
        raw: submitResponse.payload
      });
    }

    await upsertTryOnJob({
      providerTaskId: taskId,
      userId,
      productId,
      status: 'submitted',
      modelImageUrl,
      topGarmentUrl: topGarmentUrl || null,
      bottomGarmentUrl: bottomGarmentUrl || null,
      requestPayload: {
        modelImageUrl,
        topGarmentUrl,
        bottomGarmentUrl,
        resolution,
        restoreFace,
        pollIntervalMs,
        maxWaitMs
      },
      responsePayload: submitResponse.payload
    });

    const startTime = Date.now();
    const safePollInterval = Math.max(1000, Math.min(Number(pollIntervalMs) || 2500, 10000));
    const safeMaxWait = Math.max(5000, Math.min(Number(maxWaitMs) || 90000, 300000));

    while (Date.now() - startTime < safeMaxWait) {
      await sleep(safePollInterval);
      const resultResponse = await queryTryOnTask(taskId);

      if (!resultResponse.ok) {
        await upsertTryOnJob({
          providerTaskId: taskId,
          userId,
          productId,
          status: 'error',
          modelImageUrl,
          topGarmentUrl: topGarmentUrl || null,
          bottomGarmentUrl: bottomGarmentUrl || null,
          responsePayload: resultResponse.payload,
          errorMessage: 'Polling request failed'
        });

        return res.status(resultResponse.status).json({
          taskId,
          error: 'Failed while polling AILab task result',
          detail: resultResponse.payload
        });
      }

      const status = normalizeStatus(resultResponse.payload);
      const imageUrls = extractImageUrls(resultResponse.payload);

      if (status === 'done') {
        await upsertTryOnJob({
          providerTaskId: taskId,
          userId,
          productId,
          status: 'done',
          modelImageUrl,
          topGarmentUrl: topGarmentUrl || null,
          bottomGarmentUrl: bottomGarmentUrl || null,
          outputImageUrls: imageUrls,
          responsePayload: resultResponse.payload
        });

        return res.status(200).json({
          taskId,
          status,
          imageUrls,
          raw: resultResponse.payload
        });
      }

      if (status === 'failed') {
        await upsertTryOnJob({
          providerTaskId: taskId,
          userId,
          productId,
          status: 'failed',
          modelImageUrl,
          topGarmentUrl: topGarmentUrl || null,
          bottomGarmentUrl: bottomGarmentUrl || null,
          outputImageUrls: imageUrls,
          responsePayload: resultResponse.payload,
          errorMessage: resultResponse.payload?.error_msg || resultResponse.payload?.message || 'Try-on failed'
        });

        return res.status(422).json({
          taskId,
          status,
          imageUrls,
          raw: resultResponse.payload
        });
      }
    }

    await upsertTryOnJob({
      providerTaskId: taskId,
      userId,
      productId,
      status: 'timeout',
      modelImageUrl,
      topGarmentUrl: topGarmentUrl || null,
      bottomGarmentUrl: bottomGarmentUrl || null,
      errorMessage: `Task still running after ${safeMaxWait}ms`
    });

    return res.status(202).json({
      taskId,
      status: 'processing',
      message: `Task is still running after ${safeMaxWait}ms. Use /api/tryon/ailab/result?taskId=${encodeURIComponent(taskId)}`
    });
  } catch (error) {
    if (error && typeof error.message === 'string') {
      console.error('[AILAB generate error]', error.message);
    }
    return res.status(500).json({
      error: 'Failed to generate try-on result',
      detail: error.message
    });
  }
});

module.exports = router;
