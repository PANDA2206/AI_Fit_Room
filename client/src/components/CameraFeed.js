import React, { useRef, useEffect, useState, useCallback } from 'react';
import './CameraFeed.css';

const KEYPOINTS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14
};

const adjustColor = (color, amount) => {
  const hex = color.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const CameraFeed = ({ selectedCloth }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [pose, setPose] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showGuide, setShowGuide] = useState(true);
  const [actionMessage, setActionMessage] = useState('');
  const [clothImages, setClothImages] = useState({});
  const poseDetectorRef = useRef(null);
  const isDetectingRef = useRef(false);
  const streamRef = useRef(null);
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const selectedClothRef = useRef(selectedCloth);
  const poseRef = useRef(pose);

  // Keep refs updated
  useEffect(() => {
    selectedClothRef.current = selectedCloth;
  }, [selectedCloth]);

  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);

  // Load cloth image when selected cloth changes
  useEffect(() => {
    if (!selectedCloth?.image) return;
    
    const loadImage = async () => {
      // Check if already loaded
      if (clothImages[selectedCloth.id]) return;
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = selectedCloth.image;
      
      await new Promise((resolve) => {
        img.onload = () => {
          setClothImages(prev => ({
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

  // Initialize camera
  useEffect(() => {
    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1080 },
            height: { ideal: 1080 },
            aspectRatio: { ideal: 1 },
            facingMode: 'user'
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          streamRef.current = mediaStream;
          videoRef.current.play().catch(err => {
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
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!actionMessage) return undefined;
    const timer = setTimeout(() => setActionMessage(''), 2200);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  // Set canvas size once video metadata is available
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
      }
      video.play().catch(err => {
        console.warn('Video play was interrupted:', err);
      });
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, []);

  // Load MediaPipe Pose
  useEffect(() => {
    const loadPoseDetector = async () => {
      try {
        setIsLoading(true);

        // Load MediaPipe Pose from CDN
        const vision = await import('@mediapipe/tasks-vision');
        const { PoseLandmarker, FilesetResolver } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1
        });

        poseDetectorRef.current = poseLandmarker;
        setIsLoading(false);
        console.log('MediaPipe Pose loaded');
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
    };
  }, []);

  // Pose detection loop
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

    const intervalId = setInterval(detectPose, 100); // 10 FPS for pose detection
    return () => clearInterval(intervalId);
  }, [isLoading]);

  // Apply cloth overlay using pose keypoints
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
    
    // Get keypoints
    const leftShoulderRaw = landmarks[KEYPOINTS.LEFT_SHOULDER];
    const rightShoulderRaw = landmarks[KEYPOINTS.RIGHT_SHOULDER];
    const leftHipRaw = landmarks[KEYPOINTS.LEFT_HIP];
    const rightHipRaw = landmarks[KEYPOINTS.RIGHT_HIP];

    if (!leftShoulderRaw || !rightShoulderRaw || !leftHipRaw || !rightHipRaw) return;

    const leftShoulder = mapToFrame(leftShoulderRaw);
    const rightShoulder = mapToFrame(rightShoulderRaw);
    const leftHip = mapToFrame(leftHipRaw);
    const rightHip = mapToFrame(rightHipRaw);

    // Calculate body dimensions
    const shoulderLeftX = leftShoulder.x;
    const shoulderRightX = rightShoulder.x;
    const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipY = (leftHip.y + rightHip.y) / 2;

    // Mirror the X coordinates for mirrored video
    const mirroredLeftX = width - shoulderLeftX;
    const mirroredRightX = width - shoulderRightX;

    const shoulderWidth = Math.abs(mirroredLeftX - mirroredRightX);
    const torsoHeight = Math.abs(hipY - shoulderY);

    // Expand cloth size for realistic fit
    const clothWidth = shoulderWidth * 1.6;
    const clothHeight = torsoHeight * 1.3;
    const clothX = Math.min(mirroredLeftX, mirroredRightX) - (clothWidth - shoulderWidth) / 2;
    const clothY = shoulderY - clothHeight * 0.1;

    if (clothImg && clothImg.complete && clothImg.naturalWidth > 0) {
      // Draw real cloth image
      ctx.globalAlpha = 0.85;
      ctx.drawImage(clothImg, clothX, clothY, clothWidth, clothHeight);
      ctx.globalAlpha = 1.0;
    } else {
      // Fallback: Draw colored shape that follows body
      ctx.save();
      ctx.globalAlpha = 0.7;
      
      // Create gradient for more realistic look
      const gradient = ctx.createLinearGradient(clothX, clothY, clothX, clothY + clothHeight);
      gradient.addColorStop(0, cloth.color);
      gradient.addColorStop(1, adjustColor(cloth.color, -30));
      ctx.fillStyle = gradient;

      // Draw shirt shape
      ctx.beginPath();
      // Neckline
      const neckWidth = shoulderWidth * 0.3;
      const centerX = clothX + clothWidth / 2;
      
      ctx.moveTo(centerX - neckWidth / 2, clothY);
      ctx.lineTo(clothX, clothY + clothHeight * 0.1);
      ctx.lineTo(clothX - shoulderWidth * 0.2, clothY + clothHeight * 0.35); // Left sleeve
      ctx.lineTo(clothX, clothY + clothHeight * 0.35);
      ctx.lineTo(clothX, clothY + clothHeight);
      ctx.lineTo(clothX + clothWidth, clothY + clothHeight);
      ctx.lineTo(clothX + clothWidth, clothY + clothHeight * 0.35);
      ctx.lineTo(clothX + clothWidth + shoulderWidth * 0.2, clothY + clothHeight * 0.35); // Right sleeve
      ctx.lineTo(clothX + clothWidth, clothY + clothHeight * 0.1);
      ctx.lineTo(centerX + neckWidth / 2, clothY);
      ctx.quadraticCurveTo(centerX, clothY + clothHeight * 0.08, centerX - neckWidth / 2, clothY);
      ctx.closePath();
      ctx.fill();

      // Add collar
      ctx.strokeStyle = adjustColor(cloth.color, -50);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX - neckWidth / 2, clothY);
      ctx.quadraticCurveTo(centerX, clothY + clothHeight * 0.08, centerX + neckWidth / 2, clothY);
      ctx.stroke();

      ctx.restore();
    }
  }, [clothImages]);

  // Render loop
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

        // Draw mirrored video frame
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-width, 0);
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);
        ctx.restore();

        // Apply cloth overlay
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

  const addToCart = () => {
    if (!selectedClothRef.current) {
      announce('Select an item before adding to cart.');
      return;
    }
    try {
      const cart = JSON.parse(localStorage.getItem('virtualTryOnCart') || '[]');
      const exists = cart.some((item) => item.id === selectedClothRef.current.id);
      if (!exists) {
        cart.push({
          id: selectedClothRef.current.id,
          name: selectedClothRef.current.name,
          image: selectedClothRef.current.image || ''
        });
        localStorage.setItem('virtualTryOnCart', JSON.stringify(cart));
      }
      announce(exists ? 'Item already in cart.' : 'Item added to cart.');
    } catch (_error) {
      announce('Unable to update cart.');
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
          <button type="button" className="control-btn" onClick={() => announce('Advanced settings coming soon.')}>
            Settings
          </button>
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
        <button type="button" className="camera-action secondary" onClick={captureFrame}>
          Capture
        </button>
        <button type="button" className="camera-action secondary" onClick={saveLook}>
          Save
        </button>
        <button type="button" className="camera-action primary" onClick={addToCart}>
          Add to Cart
        </button>
      </div>

      {actionMessage && <p className="camera-notice">{actionMessage}</p>}
    </div>
  );
};

export default CameraFeed;
