#!/bin/bash

# Script to move the data folder outside the project for sharing between bots
# This allows multiple bots to read and write to the same data files

set -e  # Exit on error

echo "🔄 Moving data folder to shared location..."

# Define paths
PROJECT_DIR="/run/media/jooexploit/5AAAD6F9AAD6D11D/WORK/mostaql/bot-wa-traineeclient"
PARENT_DIR="/run/media/jooexploit/5AAAD6F9AAD6D11D/WORK/mostaql"
SHARED_DATA_DIR="$PARENT_DIR/mostaql-bots-data"

# Check if data folder exists in the project
if [ ! -d "$PROJECT_DIR/data" ]; then
    echo "⚠️  Warning: data folder not found in project directory"
    echo "   Creating new shared data directory..."
    mkdir -p "$SHARED_DATA_DIR"
    echo "✅ Created: $SHARED_DATA_DIR"
else
    # Check if shared data directory already exists
    if [ -d "$SHARED_DATA_DIR" ]; then
        echo "⚠️  Shared data directory already exists: $SHARED_DATA_DIR"
        read -p "   Do you want to merge the folders? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "📂 Merging data folders..."
            cp -rn "$PROJECT_DIR/data/"* "$SHARED_DATA_DIR/" 2>/dev/null || true
            echo "✅ Folders merged"
        fi
    else
        # Move the data folder to parent directory
        echo "📦 Moving data folder..."
        mv "$PROJECT_DIR/data" "$SHARED_DATA_DIR"
        echo "✅ Data folder moved to: $SHARED_DATA_DIR"
    fi
    
    # Create a symbolic link for backward compatibility (optional)
    if [ ! -L "$PROJECT_DIR/data" ] && [ ! -d "$PROJECT_DIR/data" ]; then
        echo "🔗 Creating symbolic link for backward compatibility..."
        ln -s "$SHARED_DATA_DIR" "$PROJECT_DIR/data"
        echo "✅ Symbolic link created"
    fi
fi

echo ""
echo "✅ Setup complete!"
echo "📁 Shared data directory: $SHARED_DATA_DIR"
echo ""
echo "Now you can:"
echo "  1. Use this same data folder in another bot project"
echo "  2. Both bots will read/write to the same data files"
echo "  3. Data is automatically synced between bots"
echo ""
