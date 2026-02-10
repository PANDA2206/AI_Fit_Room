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
npm install
cd client && npm install && cd ..
```

2. Set up environment variables:
Create a `.env` file in the root directory:
```
PORT=5001
NODE_ENV=development
```

3. Start the development server:
```bash
npm run dev
```

The app will run on:
- Frontend: http://localhost:3000
- Backend: http://localhost:5001

## Usage

1. Allow camera access when prompted
2. Stand in front of the camera
3. Select a cloth item from the sidebar
4. See the cloth fitted on your body in real-time

## Production Deployment (Always-On)

This repo now includes a production Docker flow:

- `Dockerfile.frontend.prod` builds and serves the React app with Nginx.
- `docker-compose.prod.yml` runs `frontend`, `backend`, `rag-service`, `weaviate`, and an Nginx reverse proxy.
- `.github/workflows/docker-publish.yml` builds and publishes Docker images to GHCR on every push to `main`.
- `deploy/deploy-prod.sh` pulls latest images and restarts the production stack.

### 1. Publish Images from GitHub Actions

On push to `main`, GitHub Actions publishes:

- `ghcr.io/<owner>/ai-fit-room-frontend:latest`
- `ghcr.io/<owner>/ai-fit-room-backend:latest`
- `ghcr.io/<owner>/ai-fit-room-rag-service:latest`

Optional GitHub repository variables for frontend build:

- `REACT_APP_API_URL` (for example: `https://app.example.com`)
- `REACT_APP_SOCKET_URL` (for example: `https://app.example.com`)

If unset, frontend defaults to same-origin at runtime.

### 2. Configure Server

On your production VM:

```bash
cp .env.prod.example .env.prod
```

Edit `.env.prod`:

- set `PUBLIC_APP_URL`
- set `WEAVIATE_API_KEY`
- set model/API keys (`HF_API_TOKEN` or `OPENAI_API_KEY`)
- ensure image names point to your GHCR namespace

### 3. Deploy

```bash
bash deploy/deploy-prod.sh
```

This runs:

- `docker compose -f docker-compose.prod.yml --env-file .env.prod pull`
- `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --remove-orphans`

### 4. TLS / HTTPS

`docker-compose.prod.yml` exposes HTTP on `PROXY_PORT` (default `80`).
Use a load balancer or TLS proxy (Nginx/Caddy/Traefik/Cloudflare) for HTTPS in production.

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
