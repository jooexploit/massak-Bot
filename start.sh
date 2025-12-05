#!/bin/bash

#  massak Bot Dashboard - Quick Start Script

echo "🤖  massak Bot Dashboard"
echo "=========================="
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
    echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found! Creating default..."
    cat > .env << EOL
PORT=3000
JWT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
NODE_ENV=development
EOL
    echo "✅ .env file created with random secrets"
    echo ""
fi

echo "🚀 Starting server..."
echo ""
echo "📱 Dashboard will be available at: http://localhost:3000"
echo ""
echo "👤 Default Credentials:"
echo "   Admin: admin / admin123"
echo "   Author: author / author123"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm start
