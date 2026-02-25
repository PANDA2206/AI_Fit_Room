import React, { useRef, useEffect, useState, useCallback } from 'react';
import './CameraFeed.css';

import * as cartService from '../services/cart';
const KEYPOINTS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28
};

const TOP_KEYWORDS = ['top', 'tee', 'tshirt', 'shirt', 'sweater', 'hoodie', 'jacket', 'coat', 'blazer', 'cardigan'];
const PANTS_KEYWORDS = ['pant', 'pants', 'trouser', 'trousers', 'jean', 'denim', 'legging', 'jogger', 'joggers', 'chino'];
const SHORTS_KEYWORDS = ['short', 'shorts'];
const SKIRT_KEYWORDS = ['skirt', 'skort'];
const DRESS_KEYWORDS = ['dress', 'gown', 'jumpsuit', 'romper'];

const classifyGarment = (cloth = {}) => {
  const tokens = [
    cloth.articleType,
    cloth.article_type,
    cloth.subcategory,
    cloth.category,
    cloth.name,
    cloth.title,
    ...(Array.isArray(cloth.tags) ? cloth.tags : [])
  ].join(' ').toLowerCase();

  if (DRESS_KEYWORDS.some((kw) => tokens.includes(kw))) return 'dress';
  if (SKIRT_KEYWORDS.some((kw) => tokens.includes(kw))) return 'skirt';
  if (SHORTS_KEYWORDS.some((kw) => tokens.includes(kw))) return 'shorts';
  if (PANTS_KEYWORDS.some((kw) => tokens.includes(kw))) return 'pants';
  if (TOP_KEYWORDS.some((kw) => tokens.includes(kw))) return 'top';
  return 'top';
};

const adjustColor = (color, amount) => {
  const hex = color.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const MIN_CONFIDENCE = 0.4;

const drawFitOverlay = (ctx, box, fitRatio) => {
  if (!box) return;
  let color = null;
  if (fitRatio < 0.9) {
    color = 'rgba(255, 99, 71, 0.25)'; // too tight
  } else if (fitRatio > 1.25) {
    color = 'rgba(80, 160, 255, 0.2)'; // too loose
  }
  if (!color) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
};

const DEFAULT_API_URL = process.env.NODE_ENV === 'production'
  ? 'https://ai-fit-room.onrender.com'
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');

const API_URL = process.env.REACT_APP_API_URL || DEFAULT_API_URL;
const SEGMENTATION_URL = process.env.REACT_APP_SEGMENTATION_URL
  || process.env.REACT_APP_RAG_URL
  || 'http://localhost:8000';

const CameraFeed = ({ selectedCloth }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [pose, setPose] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showGuide, setShowGuide] = useState(true);
  const [actionMessage, setActionMessage] = useState('');
  const [clothImages, setClothImages] = useState({});
  const [heightCm, setHeightCm] = useState('170');
  const [weightKg, setWeightKg] = useState('70');
  const [fitPreference, setFitPreference] = useState('regular');
  const [showUploadPicker, setShowUploadPicker] = useState(false);
  const [frontCapture, setFrontCapture] = useState(null);
  const [sideCapture, setSideCapture] = useState(null);
  const [sizeEstimate, setSizeEstimate] = useState(null);
  const [sizeError, setSizeError] = useState('');
  const [isEstimating, setIsEstimating] = useState(false);
  const [cutoutUnavailable, setCutoutUnavailable] = useState(false);
  const poseDetectorRef = useRef(null);
  const imagePoseDetectorRef = useRef(null);
  const isDetectingRef = useRef(false);
  const streamRef = useRef(null);
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const latestFrameRef = useRef(null);
  const latestCanvasSizeRef = useRef({ width: 0, height: 0 });
  const selectedClothRef = useRef(selectedCloth);
  const poseRef = useRef(pose);
  const frontUploadInputRef = useRef(null);
  const sideUploadInputRef = useRef(null);

  useEffect(() => {
    selectedClothRef.current = selectedCloth;
  }, [selectedCloth]);

  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);

  useEffect(() => {
    if (!selectedCloth?.image) return;

    const loadImage = async () => {
      if (clothImages[selectedCloth.id]) return;

      // If the product image is already a cutout, use it directly instead of calling segmentation.
      const isPreCutout = /processed\/apparel\/cutouts|_cutout\.png/i.test(selectedCloth.image || '');

      const fetchCutout = async () => {
        if (isPreCutout) return selectedCloth.image;

        try {
          const response = await fetch(`${SEGMENTATION_URL}/segment/cloth-only`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: selectedCloth.image })
          });

          if (!response.ok) return null;
          const data = await response.json();
          if (data?.cutout) return data.cutout;
          return null;
        } catch (err) {
          console.warn('Cutout fetch failed', err);
          return null;
        }
      };

      const tryLoad = (src, crossOriginValue) => new Promise((resolve) => {
        const img = new Image();
        if (crossOriginValue !== undefined) {
          img.crossOrigin = crossOriginValue;
          img.referrerPolicy = 'no-referrer';
        }
        img.onload = () => {
          setClothImages((prev) => ({
            ...prev,
            [selectedCloth.id]: img
          }));
          resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = src;
      });

      const loadCandidate = async (src) => {
        const loadedWithCors = await tryLoad(src, 'anonymous');
        if (loadedWithCors) return true;
        return tryLoad(src, undefined);
      };

      const cutoutUrl = await fetchCutout();
      const hasCutout = Boolean(cutoutUrl);

      let loaded = false;
      if (hasCutout) {
        loaded = await loadCandidate(cutoutUrl);
      }

      if (loaded) {
        setCutoutUnavailable(false);
        return;
      }

      // Fall back to the original image so the try-on overlay still shows something.
      setCutoutUnavailable(true);
      const originalLoaded = await loadCandidate(selectedCloth.image);
      if (!originalLoaded) {
        console.warn(`Failed to load cloth image: ${selectedCloth.image}`);
      }
    };

    loadImage();
  }, [selectedCloth, clothImages]);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 960 },
            aspectRatio: { ideal: 4 / 3 },
            facingMode: 'user'
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          streamRef.current = mediaStream;
          videoRef.current.play().catch((err) => {
            console.warn('Video play was interrupted:', err);
          });
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
        setError('Failed to access camera. Please grant camera permissions.');
      }
    };

    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!actionMessage) return undefined;
    const timer = setTimeout(() => setActionMessage(''), 2200);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width && height && canvasRef.current) {
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        videoSizeRef.current = { width, height };
        latestCanvasSizeRef.current = { width, height };
        latestFrameRef.current = {
          sx: 0,
          sy: 0,
          sWidth: width,
          sHeight: height,
          sourceWidth: width,
          sourceHeight: height
        };
      }
      video.play().catch((err) => {
        console.warn('Video play was interrupted:', err);
      });
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, []);

  useEffect(() => {
    const loadPoseDetector = async () => {
      try {
        setIsLoading(true);

        const vision = await import('@mediapipe/tasks-vision');
        const { PoseLandmarker, FilesetResolver } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const baseOptions = {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU'
        };

        const [videoPoseLandmarker, imagePoseLandmarker] = await Promise.all([
          PoseLandmarker.createFromOptions(filesetResolver, {
            baseOptions,
            runningMode: 'VIDEO',
            numPoses: 1
          }),
          PoseLandmarker.createFromOptions(filesetResolver, {
            baseOptions,
            runningMode: 'IMAGE',
            numPoses: 1
          })
        ]);

        poseDetectorRef.current = videoPoseLandmarker;
        imagePoseDetectorRef.current = imagePoseLandmarker;
        setIsLoading(false);
      } catch (err) {
        console.error('Error loading pose detector:', err);
        setError(`Failed to load AI model: ${err?.message || 'Unknown error'}`);
        setIsLoading(false);
      }
    };

    loadPoseDetector();

    return () => {
      if (poseDetectorRef.current) {
        poseDetectorRef.current.close();
      }
      if (imagePoseDetectorRef.current) {
        imagePoseDetectorRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!poseDetectorRef.current || !videoRef.current) return;

    const detectPose = () => {
      if (isDetectingRef.current) return;
      if (videoRef.current && videoRef.current.readyState === 4) {
        isDetectingRef.current = true;
        try {
          const results = poseDetectorRef.current.detectForVideo(
            videoRef.current,
            performance.now()
          );
          if (results.landmarks && results.landmarks.length > 0) {
            setPose(results.landmarks[0]);
          }
        } catch (err) {
          console.error('Error detecting pose:', err);
        } finally {
          isDetectingRef.current = false;
        }
      }
    };

    const intervalId = setInterval(detectPose, 100);
    return () => clearInterval(intervalId);
  }, [isLoading]);

  const mapLandmarkToCanvas = useCallback((point, frame, canvasSize) => {
    if (!point || !frame || !canvasSize?.width || !canvasSize?.height) {
      return null;
    }
    const sourceX = point.x * frame.sourceWidth;
    const sourceY = point.y * frame.sourceHeight;
    return {
      x: ((sourceX - frame.sx) / frame.sWidth) * canvasSize.width,
      y: ((sourceY - frame.sy) / frame.sHeight) * canvasSize.height
    };
  }, []);

  const computeMetricsFromSnapshot = useCallback((landmarks, frame, canvasSize) => {
    if (!landmarks || !frame || !canvasSize?.width || !canvasSize?.height) {
      return null;
    }

    const getPoint = (index) => mapLandmarkToCanvas(landmarks[index], frame, canvasSize);
    const distance = (pointA, pointB) => {
      if (!pointA || !pointB) return NaN;
      return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
    };
    const midpoint = (pointA, pointB) => {
      if (!pointA || !pointB) return null;
      return {
        x: (pointA.x + pointB.x) / 2,
        y: (pointA.y + pointB.y) / 2
      };
    };

    const nose = getPoint(KEYPOINTS.NOSE);
    const leftShoulder = getPoint(KEYPOINTS.LEFT_SHOULDER);
    const rightShoulder = getPoint(KEYPOINTS.RIGHT_SHOULDER);
    const leftHip = getPoint(KEYPOINTS.LEFT_HIP);
    const rightHip = getPoint(KEYPOINTS.RIGHT_HIP);
    const leftAnkle = getPoint(KEYPOINTS.LEFT_ANKLE);
    const rightAnkle = getPoint(KEYPOINTS.RIGHT_ANKLE);

    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
      return null;
    }

    const shoulderWidthPx = distance(leftShoulder, rightShoulder);
    const hipWidthPx = distance(leftHip, rightHip);
    const shoulderCenter = midpoint(leftShoulder, rightShoulder);
    const hipCenter = midpoint(leftHip, rightHip);
    const torsoHeightPx = distance(shoulderCenter, hipCenter);

    let bodyHeightPx = NaN;
    if (nose && leftAnkle && rightAnkle) {
      bodyHeightPx = distance(nose, midpoint(leftAnkle, rightAnkle));
    } else if (nose && leftAnkle) {
      bodyHeightPx = distance(nose, leftAnkle);
    } else if (nose && rightAnkle) {
      bodyHeightPx = distance(nose, rightAnkle);
    }

    if (!Number.isFinite(bodyHeightPx) || bodyHeightPx < torsoHeightPx * 1.6) {
      bodyHeightPx = torsoHeightPx * 2.55;
    }

    const chestWidthPx = shoulderWidthPx * 0.93;
    const waistWidthPx = hipWidthPx * 0.9;

    const visibilityValues = [
      landmarks[KEYPOINTS.LEFT_SHOULDER]?.visibility,
      landmarks[KEYPOINTS.RIGHT_SHOULDER]?.visibility,
      landmarks[KEYPOINTS.LEFT_HIP]?.visibility,
      landmarks[KEYPOINTS.RIGHT_HIP]?.visibility
    ].filter((value) => Number.isFinite(value));
    const confidence = visibilityValues.length > 0
      ? visibilityValues.reduce((sum, value) => sum + value, 0) / visibilityValues.length
      : 0.55;

    return {
      shoulderWidthPx: Number(shoulderWidthPx.toFixed(2)),
      chestWidthPx: Number(chestWidthPx.toFixed(2)),
      waistWidthPx: Number(waistWidthPx.toFixed(2)),
      hipWidthPx: Number(hipWidthPx.toFixed(2)),
      torsoHeightPx: Number(torsoHeightPx.toFixed(2)),
      bodyHeightPx: Number(bodyHeightPx.toFixed(2)),
      frameHeightPx: Number(canvasSize.height.toFixed(2)),
      confidence: Number(confidence.toFixed(3))
    };
  }, [mapLandmarkToCanvas]);

  const computeCurrentMetrics = useCallback(() => {
    return computeMetricsFromSnapshot(
      poseRef.current,
      latestFrameRef.current,
      latestCanvasSizeRef.current
    );
  }, [computeMetricsFromSnapshot]);

  const drawSkeleton = useCallback((ctx, landmarks, frame, canvasSize) => {
    if (!landmarks || !frame || !canvasSize?.width || !canvasSize?.height) return;

    const mapPoint = (index) => mapLandmarkToCanvas(landmarks[index], frame, canvasSize);
    const pairs = [
      [KEYPOINTS.LEFT_SHOULDER, KEYPOINTS.RIGHT_SHOULDER],
      [KEYPOINTS.LEFT_SHOULDER, KEYPOINTS.LEFT_HIP],
      [KEYPOINTS.RIGHT_SHOULDER, KEYPOINTS.RIGHT_HIP],
      [KEYPOINTS.LEFT_HIP, KEYPOINTS.RIGHT_HIP],
      [KEYPOINTS.LEFT_HIP, KEYPOINTS.LEFT_KNEE],
      [KEYPOINTS.RIGHT_HIP, KEYPOINTS.RIGHT_KNEE],
      [KEYPOINTS.LEFT_KNEE, KEYPOINTS.LEFT_ANKLE],
      [KEYPOINTS.RIGHT_KNEE, KEYPOINTS.RIGHT_ANKLE]
    ];

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    pairs.forEach(([a, b]) => {
      const p1 = mapPoint(a);
      const p2 = mapPoint(b);
      if (!p1 || !p2) return;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    const jointIndices = [
      KEYPOINTS.LEFT_SHOULDER, KEYPOINTS.RIGHT_SHOULDER,
      KEYPOINTS.LEFT_HIP, KEYPOINTS.RIGHT_HIP,
      KEYPOINTS.LEFT_KNEE, KEYPOINTS.RIGHT_KNEE,
      KEYPOINTS.LEFT_ANKLE, KEYPOINTS.RIGHT_ANKLE
    ];

    ctx.fillStyle = 'rgba(0, 200, 255, 0.9)';
    jointIndices.forEach((idx) => {
      const p = mapPoint(idx);
      if (!p) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }, [mapLandmarkToCanvas]);

  const applyClothOverlay = useCallback((ctx, cloth, landmarks, width, height, frame) => {
    if (!cloth || !landmarks || landmarks.length === 0) return;
    if (!frame || !frame.sWidth || !frame.sHeight) return;

    const clothImg = clothImages[cloth.id];
    const garmentType = classifyGarment(cloth);
    const baseColor = cloth.color || '#cfcfcf';

    const mapToFrame = (point) => {
      const sourceX = point.x * frame.sourceWidth;
      const sourceY = point.y * frame.sourceHeight;
      return {
        x: ((sourceX - frame.sx) / frame.sWidth) * width,
        y: ((sourceY - frame.sy) / frame.sHeight) * height,
      };
    };

    const leftShoulderRaw = landmarks[KEYPOINTS.LEFT_SHOULDER];
    const rightShoulderRaw = landmarks[KEYPOINTS.RIGHT_SHOULDER];
    const leftHipRaw = landmarks[KEYPOINTS.LEFT_HIP];
    const rightHipRaw = landmarks[KEYPOINTS.RIGHT_HIP];
    const leftKneeRaw = landmarks[KEYPOINTS.LEFT_KNEE];
    const rightKneeRaw = landmarks[KEYPOINTS.RIGHT_KNEE];
    const leftAnkleRaw = landmarks[KEYPOINTS.LEFT_ANKLE];
    const rightAnkleRaw = landmarks[KEYPOINTS.RIGHT_ANKLE];

    if (!leftShoulderRaw || !rightShoulderRaw || !leftHipRaw || !rightHipRaw) return;

    const leftShoulder = mapToFrame(leftShoulderRaw);
    const rightShoulder = mapToFrame(rightShoulderRaw);
    const leftHip = mapToFrame(leftHipRaw);
    const rightHip = mapToFrame(rightHipRaw);
    const leftKnee = leftKneeRaw ? mapToFrame(leftKneeRaw) : null;
    const rightKnee = rightKneeRaw ? mapToFrame(rightKneeRaw) : null;
    const leftAnkle = leftAnkleRaw ? mapToFrame(leftAnkleRaw) : null;
    const rightAnkle = rightAnkleRaw ? mapToFrame(rightAnkleRaw) : null;

    const shoulderLeftX = leftShoulder.x;
    const shoulderRightX = rightShoulder.x;
    const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipY = (leftHip.y + rightHip.y) / 2;

    const mirroredLeftX = width - shoulderLeftX;
    const mirroredRightX = width - shoulderRightX;

    const hipLeftX = width - leftHip.x;
    const hipRightX = width - rightHip.x;

    const shoulderWidth = Math.abs(mirroredLeftX - mirroredRightX);
    const hipWidth = Math.abs(hipLeftX - hipRightX);
    const torsoHeight = Math.abs(hipY - shoulderY);

    const ankleY = leftAnkle && rightAnkle ? (leftAnkle.y + rightAnkle.y) / 2 : null;
    const kneeY = leftKnee && rightKnee ? (leftKnee.y + rightKnee.y) / 2 : null;
    const legHeight = ankleY ? Math.max(ankleY - hipY, torsoHeight * 0.9) : torsoHeight * 1.4;
    const thighHeight = kneeY ? Math.max(kneeY - hipY, torsoHeight * 0.5) : torsoHeight * 0.7;

    const drawImageOrGradient = (x, y, w, h, shape = 'top') => {
      if (clothImg && clothImg.complete && clothImg.naturalWidth > 0) {
        ctx.globalAlpha = 0.88;
        ctx.drawImage(clothImg, x, y, w, h);
        ctx.globalAlpha = 1.0;
        return;
      }

      ctx.save();
      ctx.globalAlpha = 0.72;
      const gradient = ctx.createLinearGradient(x, y, x, y + h);
      gradient.addColorStop(0, baseColor);
      gradient.addColorStop(1, adjustColor(baseColor, -35));
      ctx.fillStyle = gradient;

      if (shape === 'top') {
        const neckWidth = shoulderWidth * 0.3;
        const centerX = x + w / 2;
        ctx.beginPath();
        ctx.moveTo(centerX - neckWidth / 2, y);
        ctx.lineTo(x, y + h * 0.1);
        ctx.lineTo(x - shoulderWidth * 0.2, y + h * 0.35);
        ctx.lineTo(x, y + h * 0.35);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w, y + h * 0.35);
        ctx.lineTo(x + w + shoulderWidth * 0.2, y + h * 0.35);
        ctx.lineTo(x + w, y + h * 0.1);
        ctx.lineTo(centerX + neckWidth / 2, y);
        ctx.quadraticCurveTo(centerX, y + h * 0.08, centerX - neckWidth / 2, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = adjustColor(baseColor, -50);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(centerX - neckWidth / 2, y);
        ctx.quadraticCurveTo(centerX, y + h * 0.08, centerX + neckWidth / 2, y);
        ctx.stroke();
      } else {
        const radius = Math.max(6, Math.min(w, h) * 0.06);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = adjustColor(baseColor, -45);
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.restore();
    };

    if (garmentType === 'pants' || garmentType === 'shorts' || garmentType === 'skirt') {
      const bottomWidth = hipWidth * (garmentType === 'skirt' ? 1.25 : 1.15);
      const targetHeight = (() => {
        if (garmentType === 'skirt') return thighHeight * 0.95;
        if (garmentType === 'shorts') return thighHeight * 0.65;
        return Math.max(legHeight * 1.05, torsoHeight * 0.9);
      })();
      const bottomX = Math.min(hipLeftX, hipRightX) - (bottomWidth - hipWidth) / 2;
      const bottomY = hipY - targetHeight * 0.05;
      drawImageOrGradient(bottomX, bottomY, bottomWidth, targetHeight, 'bottom');
      const bodyWidth = hipWidth;
      const fitRatio = bottomWidth / Math.max(bodyWidth, 1);
      drawFitOverlay(ctx, { x: bottomX, y: bottomY, w: bottomWidth, h: targetHeight }, fitRatio);
      return;
    }

    if (garmentType === 'dress') {
      const dressWidth = Math.max(shoulderWidth * 1.25, hipWidth * 1.3);
      const dressHeight = torsoHeight + Math.max(legHeight * 0.9, thighHeight * 1.2);
      const dressX = Math.min(mirroredLeftX, mirroredRightX) - (dressWidth - shoulderWidth) / 2;
      const dressY = shoulderY - dressHeight * 0.08;
      drawImageOrGradient(dressX, dressY, dressWidth, dressHeight, 'bottom');
      const bodyWidth = Math.max(shoulderWidth, hipWidth);
      const fitRatio = dressWidth / Math.max(bodyWidth, 1);
      drawFitOverlay(ctx, { x: dressX, y: dressY, w: dressWidth, h: dressHeight }, fitRatio);
      return;
    }

    // Default: top/outerwear anchored to torso
    const clothWidth = shoulderWidth * 1.22;
    const clothHeight = torsoHeight * 0.95;
    const clothX = Math.min(mirroredLeftX, mirroredRightX) - (clothWidth - shoulderWidth) / 2;
    const clothY = shoulderY + clothHeight * 0.04;
    drawImageOrGradient(clothX, clothY, clothWidth, clothHeight, 'top');
    const bodyWidth = Math.max(shoulderWidth, hipWidth * 0.9);
    const fitRatio = clothWidth / Math.max(bodyWidth, 1);
    drawFitOverlay(ctx, { x: clothX, y: clothY, w: clothWidth, h: clothHeight }, fitRatio);
  }, [clothImages]);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationId;

    const processFrame = () => {
      if (videoRef.current && videoRef.current.readyState === 4) {
        const video = videoRef.current;
        const width = Math.max(1, Math.round(canvas.clientWidth));
        const height = Math.max(1, Math.round(canvas.clientHeight));
        if (!width || !height) {
          animationId = requestAnimationFrame(processFrame);
          return;
        }
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (!sourceWidth || !sourceHeight) {
          animationId = requestAnimationFrame(processFrame);
          return;
        }

        const sourceAspect = sourceWidth / sourceHeight;
        const targetAspect = width / height;
        let sx = 0;
        let sy = 0;
        let sWidth = sourceWidth;
        let sHeight = sourceHeight;
        if (sourceAspect > targetAspect) {
          sWidth = sourceHeight * targetAspect;
          sx = (sourceWidth - sWidth) / 2;
        } else if (sourceAspect < targetAspect) {
          sHeight = sourceWidth / targetAspect;
          sy = (sourceHeight - sHeight) / 2;
        }

        videoSizeRef.current = { width, height };
        latestCanvasSizeRef.current = { width, height };
        latestFrameRef.current = { sx, sy, sWidth, sHeight, sourceWidth, sourceHeight };

        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-width, 0);
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);
        ctx.restore();

        if (selectedClothRef.current && poseRef.current) {
          applyClothOverlay(
            ctx,
            selectedClothRef.current,
            poseRef.current,
            width,
            height,
            { sx, sy, sWidth, sHeight, sourceWidth, sourceHeight }
          );
          drawSkeleton(
            ctx,
            poseRef.current,
            { sx, sy, sWidth, sHeight, sourceWidth, sourceHeight },
            { width, height }
          );
        }
      }

      animationId = requestAnimationFrame(processFrame);
    };

    processFrame();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [applyClothOverlay, drawSkeleton]);

  const announce = (message) => {
    setActionMessage(message);
  };

  const captureFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      announce('Camera frame is not ready yet.');
      return;
    }
    try {
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      link.download = `try-on-look-${Date.now()}.png`;
      link.click();
      announce('Snapshot saved to your downloads.');
    } catch (_error) {
      announce('Unable to capture this frame.');
    }
  };

  const saveLook = () => {
    if (!selectedClothRef.current) {
      announce('Select a style before saving a look.');
      return;
    }
    try {
      const savedLooks = JSON.parse(localStorage.getItem('savedLooks') || '[]');
      const look = {
        id: selectedClothRef.current.id,
        name: selectedClothRef.current.name,
        image: selectedClothRef.current.image || '',
        savedAt: new Date().toISOString()
      };
      localStorage.setItem('savedLooks', JSON.stringify([look, ...savedLooks].slice(0, 40)));
      announce('Look saved to your session.');
    } catch (_error) {
      announce('Unable to save this look right now.');
    }
  };

  const addToCart = async () => {
    if (!selectedClothRef.current) {
      announce('Select an item before adding to cart.');
      return;
    }
    try {
      const payload = {
        productId: selectedClothRef.current.id,
        quantity: 1
      };
      const data = await cartService.addItem(payload);
      const exists = Array.isArray(data.items)
        ? data.items.some((item) => item.id === selectedClothRef.current.id && item.quantity > 1)
        : false;
      window.dispatchEvent(new Event('cart-updated'));
      announce(exists ? 'Item already in cart.' : 'Item added to cart.');
    } catch (_error) {
      announce('Unable to update cart.');
    }
  };

  const buildLiveCapturePayload = useCallback((view) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error('Camera frame is not ready yet.');
    }

    const metrics = computeCurrentMetrics();
    if (!metrics || metrics.confidence < MIN_CONFIDENCE) {
      throw new Error('Body points not detected clearly. Stand in frame with full body visible.');
    }

    return {
      capturedAt: new Date().toISOString(),
      image: canvas.toDataURL('image/jpeg', 0.88),
      metrics,
      view,
      source: 'live'
    };
  }, [computeCurrentMetrics]);

  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });

  const fileToImage = (file) => new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unsupported image. Please upload a clear JPG or PNG.'));
    };
    image.src = objectUrl;
  });

  const buildUploadCapturePayload = useCallback(async (view, file) => {
    if (!file) {
      throw new Error('Please select an image file.');
    }
    if (!imagePoseDetectorRef.current) {
      throw new Error('Pose model is still loading. Try again in a moment.');
    }

    const image = await fileToImage(file);
    const results = imagePoseDetectorRef.current.detect(image);
    if (!results?.landmarks?.length) {
      throw new Error('Body points not detected in that image. Use a full-body photo.');
    }

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const metrics = computeMetricsFromSnapshot(
      results.landmarks[0],
      {
        sx: 0,
        sy: 0,
        sWidth: sourceWidth,
        sHeight: sourceHeight,
        sourceWidth,
        sourceHeight
      },
      { width: sourceWidth, height: sourceHeight }
    );

    if (!metrics || metrics.confidence < MIN_CONFIDENCE) {
      throw new Error('Pose confidence too low. Upload a clearer, full-body photo.');
    }

    return {
      capturedAt: new Date().toISOString(),
      image: await fileToDataUrl(file),
      metrics,
      view,
      source: 'upload'
    };
  }, [computeMetricsFromSnapshot]);

  const captureMeasurementView = (view) => {
    try {
      const capturePayload = buildLiveCapturePayload(view);
      if (view === 'front') {
        setFrontCapture(capturePayload);
        announce('Front view captured.');
      } else {
        setSideCapture(capturePayload);
        announce('Side view captured.');
      }
      setSizeEstimate(null);
      setSizeError('');
    } catch (captureError) {
      const message = captureError.message || 'Unable to capture from live feed.';
      announce(message);
      setSizeError(message);
    }
  };

  const processUploadedCapture = async (view, file) => {
    try {
      const capturePayload = await buildUploadCapturePayload(view, file);
      if (view === 'front') {
        setFrontCapture(capturePayload);
        announce('Front upload processed.');
      } else {
        setSideCapture(capturePayload);
        announce('Side upload processed.');
      }
      setSizeEstimate(null);
      setSizeError('');
    } catch (uploadError) {
      const message = uploadError.message || 'Unable to process uploaded image.';
      announce(message);
      setSizeError(message);
    }
  };

  const handleUploadCapture = (view, event) => {
    const file = event.target.files?.[0];
    if (file) {
      setShowUploadPicker(false);
      processUploadedCapture(view, file);
    }
    // eslint-disable-next-line no-param-reassign
    event.target.value = '';
  };

  const estimateSize = async () => {
    const parsedHeight = Number(heightCm);
    const parsedWeight = Number(weightKg);
    if (!Number.isFinite(parsedHeight) || parsedHeight < 120 || parsedHeight > 230) {
      setSizeError('Enter a valid height between 120 cm and 230 cm.');
      return;
    }
    if (!Number.isFinite(parsedWeight) || parsedWeight < 30 || parsedWeight > 250) {
      setSizeError('Enter a valid weight between 30 kg and 250 kg.');
      return;
    }
    if (!frontCapture || !sideCapture) {
      setSizeError('Capture both front and side views before estimating size.');
      return;
    }

    const frontConf = frontCapture?.metrics?.confidence ?? 0;
    const sideConf = sideCapture?.metrics?.confidence ?? 0;
    if (frontConf < MIN_CONFIDENCE || sideConf < MIN_CONFIDENCE) {
      setSizeError('Front/side pose quality is low. Recapture clearer, full-body shots.');
      return;
    }

    setIsEstimating(true);
    setSizeError('');

    try {
      const response = await fetch(`${API_URL}/api/size-estimation/estimate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          profile: {
            heightCm: parsedHeight,
            weightKg: parsedWeight,
            fitPreference
          },
          selectedCloth: selectedCloth
            ? {
              id: selectedCloth.id,
              name: selectedCloth.name,
              category: selectedCloth.category,
              subcategory: selectedCloth.subcategory,
              gender: selectedCloth.gender
            }
            : null,
          front: {
            image: frontCapture.image,
            metrics: frontCapture.metrics
          },
          side: {
            image: sideCapture.image,
            metrics: sideCapture.metrics
          }
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || result.detail || 'Size estimation failed');
      }

      setSizeEstimate(result);
      announce('Size estimate generated.');
    } catch (estimateError) {
      setSizeError(estimateError.message || 'Unable to estimate size right now.');
    } finally {
      setIsEstimating(false);
    }
  };

  return (
    <div className="camera-feed-container">
      <div className="camera-panel-header">
        <h2>Live Fitting</h2>
        <div className="camera-controls">
          <button type="button" className="control-btn" onClick={() => setShowGuide((prev) => !prev)}>
            {showGuide ? 'Guide Off' : 'Guide On'}
          </button>
          <button type="button" className="control-btn" onClick={captureFrame}>Capture</button>
          <button type="button" className="control-btn" onClick={() => announce('Advanced settings coming soon.')}>Settings</button>
        </div>
      </div>

      <div className="camera-stage">
        <div className="camera-wrapper">
          <div className="try-on-badge">
            <span className="live-indicator" />
            Live Session
          </div>
          {error && <div className="error-message">{error}</div>}
          {isLoading && <div className="loading-message">Loading AI model...</div>}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ display: 'none' }}
          />

          <canvas
            ref={canvasRef}
            className="camera-canvas"
          />

          {showGuide && (
            <div className="body-guide">
              <div className="guide-outline">
                <div className="guide-icon">⌖</div>
                <p>Position within frame</p>
                <span>Stand about 2 meters away</span>
              </div>
            </div>
          )}

          {selectedCloth && (
            <div className="selected-cloth-info">
              <p>Wearing: {selectedCloth.name}</p>
              {cutoutUnavailable && (
                <span className="selected-cloth-warning">Using original image (cutout unavailable)</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="camera-action-buttons">
        <button type="button" className="camera-action secondary" onClick={saveLook}>
          Save
        </button>
        <button type="button" className="camera-action primary" onClick={addToCart}>
          Add to Cart
        </button>
      </div>

      <div className="size-estimator-panel">
        <div className="size-estimator-header">
          <h3>Size Estimation (MVP)</h3>
          <span>{selectedCloth?.name ? `For ${selectedCloth.name}` : 'General fit profile'}</span>
        </div>

        <div className="size-estimator-controls">
          <label className="size-field">
            Height (cm)
            <input
              type="number"
              min="120"
              max="230"
              step="1"
              value={heightCm}
              onChange={(event) => setHeightCm(event.target.value)}
            />
          </label>
          <label className="size-field">
            Weight (kg)
            <input
              type="number"
              min="30"
              max="250"
              step="1"
              value={weightKg}
              onChange={(event) => setWeightKg(event.target.value)}
            />
          </label>
          <label className="size-field">
            Fit
            <select value={fitPreference} onChange={(event) => setFitPreference(event.target.value)}>
              <option value="regular">Regular</option>
              <option value="slim">Slim</option>
              <option value="relaxed">Relaxed</option>
            </select>
          </label>
        </div>

        <div className="size-estimator-actions">
          <button type="button" className="size-btn secondary" onClick={() => captureMeasurementView('front')}>
            Capture Front
          </button>
          <button type="button" className="size-btn secondary" onClick={() => captureMeasurementView('side')}>
            Capture Side
          </button>
          <button
            type="button"
            className="size-btn tertiary size-btn-full"
            onClick={() => setShowUploadPicker((prev) => !prev)}
          >
            {showUploadPicker ? 'Hide Upload Inputs' : 'Upload Views'}
          </button>
          {showUploadPicker && (
            <div className="upload-chooser">
              <button
                type="button"
                className="size-btn tertiary"
                onClick={() => frontUploadInputRef.current?.click()}
              >
                Upload Front
              </button>
              <button
                type="button"
                className="size-btn tertiary"
                onClick={() => sideUploadInputRef.current?.click()}
              >
                Upload Side
              </button>
            </div>
          )}
          <button
            type="button"
            className="size-btn primary"
            onClick={estimateSize}
            disabled={isEstimating}
          >
            {isEstimating ? 'Estimating...' : 'Estimate Size'}
          </button>
        </div>

        <input
          ref={frontUploadInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="size-upload-input"
          onChange={(event) => handleUploadCapture('front', event)}
        />
        <input
          ref={sideUploadInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="size-upload-input"
          onChange={(event) => handleUploadCapture('side', event)}
        />

        <p className="capture-status">
          Front: {frontCapture ? (frontCapture.source === 'upload' ? 'Uploaded' : 'Live') : 'Pending'}
          {' | '}
          Side: {sideCapture ? (sideCapture.source === 'upload' ? 'Uploaded' : 'Live') : 'Pending'}
        </p>

        {sizeError && <p className="size-error">{sizeError}</p>}

        {sizeEstimate && (
          <div className="size-estimate-result">
            <p className="size-main">
              Recommended Size: <strong>{sizeEstimate.recommended?.primary || 'N/A'}</strong>
            </p>
            <p className="size-sub">
              Type: {sizeEstimate.recommended?.garmentType || 'top'} | Confidence: {sizeEstimate.recommended?.confidence || 'low'}
            </p>
            <p className="size-sub">
              Chest {sizeEstimate.measurementsCm?.chest} cm | Waist {sizeEstimate.measurementsCm?.waist} cm | Hip {sizeEstimate.measurementsCm?.hip} cm
            </p>
          </div>
        )}
      </div>

      {actionMessage && <p className="camera-notice">{actionMessage}</p>}
    </div>
  );
};

export default CameraFeed;
