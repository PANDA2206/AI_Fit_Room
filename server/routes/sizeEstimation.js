const express = require('express');

const router = express.Router();

function toNumber(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safePositive(value, fallback = NaN) {
  const parsed = toNumber(value, fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function ellipsePerimeter(widthCm, depthCm) {
  const a = Math.max(widthCm / 2, 0.1);
  const b = Math.max(depthCm / 2, 0.1);
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function average(values) {
  const list = values.filter((value) => Number.isFinite(value));
  if (list.length === 0) {
    return NaN;
  }
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function normalizeGender(input = '') {
  const text = String(input || '').trim().toLowerCase();
  if (['male', 'man', 'mens', 'men'].includes(text)) return 'men';
  if (['female', 'woman', 'womens', 'women'].includes(text)) return 'women';
  return 'unisex';
}

function inferGarmentType(selectedCloth = {}) {
  const tokens = [
    selectedCloth.category,
    selectedCloth.subcategory,
    selectedCloth.name
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    tokens.includes('pant') ||
    tokens.includes('jean') ||
    tokens.includes('trouser') ||
    tokens.includes('short') ||
    tokens.includes('skirt')
  ) {
    return 'bottom';
  }
  return 'top';
}

const SIZE_CHARTS = {
  men: {
    top: [
      { size: 'XS', chest: [84, 90], waist: [70, 76], hip: [86, 92] },
      { size: 'S', chest: [90, 96], waist: [76, 82], hip: [92, 98] },
      { size: 'M', chest: [96, 102], waist: [82, 88], hip: [98, 104] },
      { size: 'L', chest: [102, 110], waist: [88, 96], hip: [104, 112] },
      { size: 'XL', chest: [110, 118], waist: [96, 104], hip: [112, 120] },
      { size: 'XXL', chest: [118, 126], waist: [104, 112], hip: [120, 128] }
    ],
    bottom: [
      { size: 'XS', waist: [68, 74], hip: [84, 90] },
      { size: 'S', waist: [74, 80], hip: [90, 96] },
      { size: 'M', waist: [80, 86], hip: [96, 102] },
      { size: 'L', waist: [86, 94], hip: [102, 110] },
      { size: 'XL', waist: [94, 102], hip: [110, 118] },
      { size: 'XXL', waist: [102, 110], hip: [118, 126] }
    ]
  },
  women: {
    top: [
      { size: 'XS', chest: [78, 84], waist: [60, 66], hip: [84, 90] },
      { size: 'S', chest: [84, 90], waist: [66, 72], hip: [90, 96] },
      { size: 'M', chest: [90, 96], waist: [72, 78], hip: [96, 102] },
      { size: 'L', chest: [96, 104], waist: [78, 86], hip: [102, 110] },
      { size: 'XL', chest: [104, 112], waist: [86, 94], hip: [110, 118] },
      { size: 'XXL', chest: [112, 120], waist: [94, 102], hip: [118, 126] }
    ],
    bottom: [
      { size: 'XS', waist: [58, 64], hip: [84, 90] },
      { size: 'S', waist: [64, 70], hip: [90, 96] },
      { size: 'M', waist: [70, 76], hip: [96, 102] },
      { size: 'L', waist: [76, 84], hip: [102, 110] },
      { size: 'XL', waist: [84, 92], hip: [110, 118] },
      { size: 'XXL', waist: [92, 100], hip: [118, 126] }
    ]
  }
};

function scoreToRange(value, range) {
  const [min, max] = range;
  if (value >= min && value <= max) {
    return 0;
  }
  const width = Math.max(max - min, 1);
  if (value < min) {
    return (min - value) / width;
  }
  return (value - max) / width;
}

function rankSizeCandidates({ chart, garmentType, chestCm, waistCm, hipCm }) {
  return chart
    .map((row) => {
      if (garmentType === 'top') {
        const chestScore = scoreToRange(chestCm, row.chest);
        const waistScore = scoreToRange(waistCm, row.waist);
        return {
          size: row.size,
          score: chestScore + waistScore * 0.55
        };
      }

      const waistScore = scoreToRange(waistCm, row.waist);
      const hipScore = scoreToRange(hipCm, row.hip);
      return {
        size: row.size,
        score: waistScore + hipScore * 0.65
      };
    })
    .sort((a, b) => a.score - b.score);
}

function parseCaptureMetrics(rawCapture = {}) {
  const metrics = rawCapture.metrics || {};
  const shoulderWidthPx = safePositive(metrics.shoulderWidthPx);
  const chestWidthPx = safePositive(metrics.chestWidthPx, shoulderWidthPx * 0.92);
  const waistWidthPx = safePositive(metrics.waistWidthPx, chestWidthPx * 0.9);
  const hipWidthPx = safePositive(metrics.hipWidthPx, waistWidthPx * 1.08);
  const torsoHeightPx = safePositive(metrics.torsoHeightPx);
  const bodyHeightPx = safePositive(metrics.bodyHeightPx, torsoHeightPx * 2.55);
  const frameHeightPx = safePositive(metrics.frameHeightPx);
  const confidence = clamp(toNumber(metrics.confidence, 0.55), 0.2, 1);

  return {
    shoulderWidthPx,
    chestWidthPx,
    waistWidthPx,
    hipWidthPx,
    torsoHeightPx,
    bodyHeightPx,
    frameHeightPx,
    confidence
  };
}

function deriveMeasurements({ heightCm, front, side }) {
  const scaleCmPerPx = heightCm / average([front.bodyHeightPx, side.bodyHeightPx]);

  const shoulderCm = average([front.shoulderWidthPx, side.shoulderWidthPx * 1.18]) * scaleCmPerPx;
  const chestWidthCm = front.chestWidthPx * scaleCmPerPx;
  const chestDepthCm = clamp(side.chestWidthPx * scaleCmPerPx * 1.05, chestWidthCm * 0.42, chestWidthCm * 0.86);
  const waistWidthCm = front.waistWidthPx * scaleCmPerPx;
  const waistDepthCm = clamp(side.waistWidthPx * scaleCmPerPx * 1.06, waistWidthCm * 0.45, waistWidthCm * 0.92);
  const hipWidthCm = front.hipWidthPx * scaleCmPerPx;
  const hipDepthCm = clamp(side.hipWidthPx * scaleCmPerPx * 1.08, hipWidthCm * 0.5, hipWidthCm * 0.95);
  const torsoHeightCm = average([front.torsoHeightPx, side.torsoHeightPx]) * scaleCmPerPx;

  const chestCm = ellipsePerimeter(chestWidthCm, chestDepthCm);
  const waistCm = ellipsePerimeter(waistWidthCm, waistDepthCm);
  const hipCm = ellipsePerimeter(hipWidthCm, hipDepthCm);
  const torsoVolumeLiters = (Math.PI * (chestWidthCm / 2) * (chestDepthCm / 2) * torsoHeightCm) / 1000;

  return {
    scaleCmPerPx,
    shoulderCm,
    chestCm,
    waistCm,
    hipCm,
    torsoDepthCm: chestDepthCm,
    torsoHeightCm,
    torsoVolumeLiters
  };
}

function estimateConfidence({ ranking, frontConfidence, sideConfidence, measurementOutlierCount }) {
  const bestScore = ranking[0]?.score ?? 1;
  const captureQuality = average([frontConfidence, sideConfidence]);

  let score = 0.4;
  score += clamp(1 - bestScore, 0, 0.42);
  score += clamp((captureQuality - 0.45) * 0.6, 0, 0.2);
  score -= measurementOutlierCount * 0.08;
  score = clamp(score, 0.15, 0.95);

  if (score >= 0.72) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

router.post('/estimate', async (req, res) => {
  const heightCm = safePositive(req.body?.profile?.heightCm);
  const fitPreference = String(req.body?.profile?.fitPreference || 'regular').toLowerCase();
  const selectedCloth = req.body?.selectedCloth || {};
  const front = parseCaptureMetrics(req.body?.front || {});
  const side = parseCaptureMetrics(req.body?.side || {});

  if (!Number.isFinite(heightCm) || heightCm < 120 || heightCm > 230) {
    return res.status(400).json({ error: 'profile.heightCm must be between 120 and 230' });
  }

  const requiredFront = [front.shoulderWidthPx, front.hipWidthPx, front.torsoHeightPx, front.bodyHeightPx];
  const requiredSide = [side.shoulderWidthPx, side.hipWidthPx, side.torsoHeightPx, side.bodyHeightPx];
  if (requiredFront.some((value) => !Number.isFinite(value)) || requiredSide.some((value) => !Number.isFinite(value))) {
    return res.status(400).json({
      error: 'front and side capture metrics are incomplete',
      detail: 'Capture both views with full body in frame before estimating size.'
    });
  }

  const garmentType = inferGarmentType(selectedCloth);
  const gender = normalizeGender(selectedCloth.gender || req.body?.profile?.gender || 'unisex');
  const chartGroup = gender === 'women' ? 'women' : 'men';
  const chart = SIZE_CHARTS[chartGroup][garmentType];

  const measurements = deriveMeasurements({ heightCm, front, side });

  const ranking = rankSizeCandidates({
    chart,
    garmentType,
    chestCm: measurements.chestCm,
    waistCm: measurements.waistCm,
    hipCm: measurements.hipCm
  });

  const fitOffset = fitPreference === 'relaxed' ? 1 : fitPreference === 'slim' ? -1 : 0;
  const baseIndex = chart.findIndex((row) => row.size === ranking[0].size);
  const adjustedIndex = clamp(baseIndex + fitOffset, 0, chart.length - 1);
  const primarySize = chart[adjustedIndex].size;

  const secondarySizes = [adjustedIndex - 1, adjustedIndex + 1]
    .filter((index) => index >= 0 && index < chart.length)
    .map((index) => chart[index].size);

  const measurementOutlierCount = [
    measurements.chestCm < 70 || measurements.chestCm > 150,
    measurements.waistCm < 55 || measurements.waistCm > 145,
    measurements.hipCm < 70 || measurements.hipCm > 165
  ].filter(Boolean).length;

  const confidence = estimateConfidence({
    ranking,
    frontConfidence: front.confidence,
    sideConfidence: side.confidence,
    measurementOutlierCount
  });

  const notes = [
    'MVP heuristic estimate using 2D front/side captures (not full voxel reconstruction).',
    'For best result: form-fitting clothes, full body in frame, camera at torso height.',
    fitPreference === 'slim'
      ? 'Slim fit preference applied: recommendation shifted one step smaller when possible.'
      : fitPreference === 'relaxed'
        ? 'Relaxed fit preference applied: recommendation shifted one step larger when possible.'
        : 'Regular fit preference applied.'
  ];

  return res.status(200).json({
    recommended: {
      garmentType,
      primary: primarySize,
      secondary: secondarySizes,
      confidence
    },
    measurementsCm: {
      shoulder: Number(measurements.shoulderCm.toFixed(1)),
      chest: Number(measurements.chestCm.toFixed(1)),
      waist: Number(measurements.waistCm.toFixed(1)),
      hip: Number(measurements.hipCm.toFixed(1)),
      torsoDepth: Number(measurements.torsoDepthCm.toFixed(1)),
      torsoHeight: Number(measurements.torsoHeightCm.toFixed(1))
    },
    diagnostics: {
      torsoVolumeLiters: Number(measurements.torsoVolumeLiters.toFixed(2)),
      scaleCmPerPx: Number(measurements.scaleCmPerPx.toFixed(5)),
      captureConfidence: Number(average([front.confidence, side.confidence]).toFixed(2))
    },
    notes
  });
});

module.exports = router;
