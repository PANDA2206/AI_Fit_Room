const tf = require('@tensorflow/tfjs-node');
const bodyPix = require('@tensorflow-models/body-pix');

let model = null;

// Initialize the body segmentation model
async function loadModel() {
  if (!model) {
    console.log('Loading BodyPix model...');
    model = await bodyPix.load({
      architecture: 'MobileNetV1',
      outputStride: 16,
      multiplier: 0.75,
      quantBytes: 2
    });
    console.log('BodyPix model loaded successfully');
  }
  return model;
}

// Detect body parts in an image
async function detectBodyParts(imageData) {
  const model = await loadModel();
  
  const segmentation = await model.segmentPerson(imageData, {
    flipHorizontal: false,
    internalResolution: 'medium',
    segmentationThreshold: 0.7
  });

  return segmentation;
}

// Get body keypoints for positioning clothes
async function getBodyPose(imageData) {
  const model = await loadModel();
  
  const pose = await model.estimatePoses(imageData, {
    flipHorizontal: false,
    maxPoseDetections: 1,
    scoreThreshold: 0.5
  });

  return pose;
}

module.exports = {
  loadModel,
  detectBodyParts,
  getBodyPose
};
