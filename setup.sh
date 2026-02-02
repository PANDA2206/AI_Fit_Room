#!/bin/bash

echo "🚀 Setting up Virtual Try-On Application..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js version: $(node -v)"
echo "✅ npm version: $(npm -v)"
echo ""

# Install root dependencies
echo "📦 Installing backend dependencies..."
npm install

# Install client dependencies
echo "📦 Installing frontend dependencies..."
cd client
npm install
cd ..

echo ""
echo "✅ Installation complete!"
echo ""
echo "To start the application:"
echo "1. Run: npm run dev"
echo "2. Backend will run on: http://localhost:5000"
echo "3. Frontend will run on: http://localhost:3000"
echo ""
echo "Make sure to allow camera access when prompted!"
