import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
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
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28
};

const adjustColor = (color, amount) => {
  const hex = color.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const API_URL = process.env.REACT_APP_API_URL
  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');

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

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = selectedCloth.image;

      await new Promise((resolve) => {
        img.onload = () => {
          setClothImages((prev) => ({
            ...prev,
            [selectedCloth.id]: img
          }));
          resolve();
        };
        img.onerror = () => {
          console.warn(`Failed to load cloth image: ${selectedCloth.image}`);
          resolve();
        };
      });
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

  const applyClothOverlay = useCallback((ctx, cloth, landmarks, width, height, frame) => {
    if (!cloth || !landmarks || landmarks.length === 0) return;
    if (!frame || !frame.sWidth || !frame.sHeight) return;

    const clothImg = clothImages[cloth.id];

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

    if (!leftShoulderRaw || !rightShoulderRaw || !leftHipRaw || !rightHipRaw) return;

    const leftShoulder = mapToFrame(leftShoulderRaw);
    const rightShoulder = mapToFrame(rightShoulderRaw);
    const leftHip = mapToFrame(leftHipRaw);
    const rightHip = mapToFrame(rightHipRaw);

    const shoulderLeftX = leftShoulder.x;
    const shoulderRightX = rightShoulder.x;
    const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipY = (leftHip.y + rightHip.y) / 2;

    const mirroredLeftX = width - shoulderLeftX;
    const mirroredRightX = width - shoulderRightX;

    const shoulderWidth = Math.abs(mirroredLeftX - mirroredRightX);
    const torsoHeight = Math.abs(hipY - shoulderY);

    const clothWidth = shoulderWidth * 1.6;
    const clothHeight = torsoHeight * 1.3;
    const clothX = Math.min(mirroredLeftX, mirroredRightX) - (clothWidth - shoulderWidth) / 2;
    const clothY = shoulderY - clothHeight * 0.1;

    if (clothImg && clothImg.complete && clothImg.naturalWidth > 0) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(clothImg, clothX, clothY, clothWidth, clothHeight);
      ctx.globalAlpha = 1.0;
    } else {
      ctx.save();
      ctx.globalAlpha = 0.7;

      const gradient = ctx.createLinearGradient(clothX, clothY, clothX, clothY + clothHeight);
      gradient.addColorStop(0, cloth.color);
      gradient.addColorStop(1, adjustColor(cloth.color, -30));
      ctx.fillStyle = gradient;

      ctx.beginPath();
      const neckWidth = shoulderWidth * 0.3;
      const centerX = clothX + clothWidth / 2;

      ctx.moveTo(centerX - neckWidth / 2, clothY);
      ctx.lineTo(clothX, clothY + clothHeight * 0.1);
      ctx.lineTo(clothX - shoulderWidth * 0.2, clothY + clothHeight * 0.35);
      ctx.lineTo(clothX, clothY + clothHeight * 0.35);
      ctx.lineTo(clothX, clothY + clothHeight);
      ctx.lineTo(clothX + clothWidth, clothY + clothHeight);
      ctx.lineTo(clothX + clothWidth, clothY + clothHeight * 0.35);
      ctx.lineTo(clothX + clothWidth + shoulderWidth * 0.2, clothY + clothHeight * 0.35);
      ctx.lineTo(clothX + clothWidth, clothY + clothHeight * 0.1);
      ctx.lineTo(centerX + neckWidth / 2, clothY);
      ctx.quadraticCurveTo(centerX, clothY + clothHeight * 0.08, centerX - neckWidth / 2, clothY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = adjustColor(cloth.color, -50);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX - neckWidth / 2, clothY);
      ctx.quadraticCurveTo(centerX, clothY + clothHeight * 0.08, centerX + neckWidth / 2, clothY);
      ctx.stroke();

      ctx.restore();
    }
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
  }, [applyClothOverlay]);

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
    if (!metrics) {
      throw new Error('Body points not detected. Stand clearly in frame and try again.');
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

    if (!metrics) {
      throw new Error('Unable to estimate body metrics from this image.');
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
            metrics: frontCapture.metrics
          },
          side: {
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
