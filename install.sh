#!/bin/bash

set -e

APP_NAME="wharfie"
REPO="wharfie/wharfie" # Replace with your GitHub username/repo
VERSION="latest" # Use a specific version if necessary

echo "Installing $APP_NAME..."

# Determine platform and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map architecture to common names
case $ARCH in
  x86_64) ARCH="x64" ;;
  arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Construct download URL
if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$APP_NAME-$OS-$ARCH"
else
  DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$APP_NAME-$OS-$ARCH"
fi

# Download the binary
TEMP_FILE=$(mktemp)
echo "Downloading $APP_NAME from $DOWNLOAD_URL..."
curl -L -o "$TEMP_FILE" "$DOWNLOAD_URL"

# Make the binary executable
chmod +x "$TEMP_FILE"

# Move the binary to /usr/local/bin
echo "Installing $APP_NAME to /usr/local/bin..."
sudo mv "$TEMP_FILE" "/usr/local/bin/$APP_NAME"

echo "$APP_NAME installed successfully!"