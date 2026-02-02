# Virtual Try-On Application

A real-time virtual try-on application that uses your laptop camera to fit clothes on your body.

## Features

- 🎥 Real-time camera feed
- 👕 Virtual cloth overlay
- 🤖 Body detection using AI
- ⚡ WebSocket for real-time communication
- 📱 Responsive design

## Tech Stack

### Frontend
- React.js
- WebRTC for camera access
- Socket.IO client
- TensorFlow.js for client-side ML

### Backend
- Node.js + Express
- Socket.IO for real-time communication
- TensorFlow.js (Node) for body detection
- Canvas for image processing

## Installation

1. Install all dependencies:
```bash
npm run install-all
```

2. Set up environment variables:
Create a `.env` file in the root directory:
```
PORT=5000
NODE_ENV=development
```

3. Start the development server:
```bash
npm run dev
```

The app will run on:
- Frontend: http://localhost:3000
- Backend: http://localhost:5000

## Usage

1. Allow camera access when prompted
2. Stand in front of the camera
3. Select a cloth item from the sidebar
4. See the cloth fitted on your body in real-time

## Project Structure

```
app/
├── client/              # React frontend
│   ├── public/
│   └── src/
│       ├── components/
│       ├── services/
│       ├── utils/
│       └── App.js
├── server/              # Node.js backend
│   ├── index.js
│   ├── routes/
│   └── utils/
└── package.json
```
# AI_Fit_Room
