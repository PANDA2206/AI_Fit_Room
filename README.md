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
DB_ENABLED=true
DB_HOST=localhost
DB_PORT=5432
DB_USER=app_user
DB_PASSWORD=app_password
DB_NAME=virtual_tryon
JWT_SECRET=dev-only-change-me
```

3. Start the development server:
```bash
npm run dev
```

The app will run on:
- Frontend: http://localhost:3000
- Backend: http://localhost:5001

## Database + Auth

Backend now uses PostgreSQL for persistent data:

- `users`
- `user_sessions`
- `products`
- `product_tags`
- `tryon_jobs`

Run migrations and seed manually if needed:

```bash
npm run db:migrate
npm run db:seed
```

JWT-ready user endpoints:

- `POST /api/users/register`
- `POST /api/users/login`
- `GET /api/users/me` (Bearer token required)
- `GET /api/users/:id/tryon-jobs` (Bearer token required; self/admin/staff)

Notes:

- `tryon_jobs` stores async virtual try-on task status/results.
- `products` and tags are no longer in-memory; they persist in Postgres.
- Product catalog supports dataset metadata fields (`public_id`, `title`, `source_id`, `dataset_name`, `dataset_item_id`, `master_category`, `article_type`, `base_colour`, `season`, `usage`, `release_year`).
- The collection UI reads image URLs directly from DB metadata (no local SVG fallback catalog).

Supabase + Kaggle flow (Fashion Product Images Dataset):

```bash
# 1) point backend DB to Supabase Postgres
export DATABASE_URL='postgresql://...'

# 2) download + extract Kaggle dataset
# kaggle datasets download -d <fashion-product-images-dataset-slug> -p ./data --unzip

# (alternative) download via kagglehub (requires KAGGLEHUB_TOKEN=KGAT_...)
# python3 -m pip install --user kagglehub
# export KAGGLEHUB_TOKEN='KGAT_...'
# python3 server/scripts/downloadFashionDatasetFromKaggleHub.py

# 3) configure Supabase storage + extracted Kaggle dataset folder
export SUPABASE_URL='https://<project-ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'
export SUPABASE_PUBLISHABLE_KEY='...'
export SUPABASE_STORAGE_BUCKET='fashion-products'
export SUPABASE_S3_ENDPOINT='https://<project-ref>.storage.supabase.co/storage/v1/s3'
export SUPABASE_S3_REGION='us-east-1'
export SUPABASE_S3_ACCESS_KEY_ID='...'
export SUPABASE_S3_SECRET_ACCESS_KEY='...'

# Optional: store product images in an external S3-compatible bucket (recommended for large datasets).
# Example (Tebi):
# export PRODUCT_IMAGE_S3_BUCKET='app-product'
# export PRODUCT_IMAGE_S3_ENDPOINT='https://s3.tebi.io'
# export PRODUCT_IMAGE_S3_REGION='us-east-1'
# export PRODUCT_IMAGE_S3_ACCESS_KEY_ID='...'
# export PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY='...'
# export PRODUCT_IMAGE_S3_FORCE_PATH_STYLE='false'
# export PRODUCT_IMAGE_PUBLIC_BASE_URL='https://app-product.s3.tebi.io'
export KAGGLEHUB_TOKEN='KGAT_...'
export FASHION_DATASET_DIR='./data/fashion-product-images-dataset'

# 4) import products (uploads images to Supabase Storage + upserts metadata in Supabase Postgres)
npm run products:fashion:import

# (or inside container)
docker compose exec backend node server/scripts/importFashionDatasetToSupabase.js
```

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
- set `DATABASE_URL` to your Supabase Postgres connection string
- set `SUPABASE_URL` and either:
- `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_PUBLISHABLE_KEY` for Storage REST uploads, or
- S3 credentials (`SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`) for S3-compatible uploads
- set `SUPABASE_STORAGE_BUCKET`
- optional: set `PRODUCT_IMAGE_S3_*` + `PRODUCT_IMAGE_PUBLIC_BASE_URL` to store product images in an external S3-compatible bucket
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

## AILabTools Try-On API Integration

Backend now includes AILab async try-on routes:

- `POST /api/tryon/ailab/submit`
- `GET /api/tryon/ailab/result?taskId=...`
- `POST /api/tryon/ailab/generate` (submit + poll)

Required env vars:

- `AILAB_API_KEY`
- `AILAB_API_BASE` (default `https://www.ailabapi.com`)
- `AILAB_TIMEOUT_MS` (default `60000`)

Example request (`/api/tryon/ailab/generate`):

```json
{
  "modelImageUrl": "https://example.com/person.jpg",
  "topGarmentUrl": "https://example.com/top.jpg",
  "bottomGarmentUrl": "https://example.com/bottom.jpg",
  "restoreFace": true,
  "resolution": -1
}
```

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
