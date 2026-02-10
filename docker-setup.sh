#!/bin/bash

echo "🐳 AI Fit Room - Docker Setup"
echo "=============================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose plugin is not installed. Please install Docker Desktop/Compose first."
    exit 1
fi

echo "✅ Docker found: $(docker --version)"
echo "✅ Docker Compose found: $(docker compose version)"
echo ""

# macOS metadata files can break Docker context transfer on external drives
if command -v dot_clean &> /dev/null; then
    echo "🧹 Cleaning macOS metadata sidecar files..."
    dot_clean -m .
fi

echo "🏗️  Building containers..."
docker compose build

echo ""
echo "🚀 Starting application..."
docker compose up -d

echo ""
echo "✅ Application is running!"
echo ""
echo "Access the app at:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:5000"
echo ""
echo "To stop the application, run:"
echo "  docker compose down"
echo ""
echo "To view logs, run:"
echo "  docker compose logs -f"
