#!/bin/bash

set -e

APP_NAME="wharfie"
REPO="wharfie/wharfie"

# If a version wasn't passed in, find the latest version from GitHub
if [ -z "$1" ]; then
  echo "Determining the latest version from GitHub..."
  LATEST_VERSION=$(curl -sSL "https://api.github.com/repos/$REPO/releases/latest" | grep -oP '(?<="tag_name": ")[^"]+')
  VERSION="$LATEST_VERSION"
else
  VERSION="$1"
fi

echo "Installing $APP_NAME version: $VERSION"

# Detect OS
UNAME_S=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$UNAME_S" in
  linux)
    OS="linux"
    INSTALL_DIR="/usr/local/bin"        # Common on Linux
    BIN_NAME="$APP_NAME"
    ;;
  darwin)
    OS="darwin"
    INSTALL_DIR="/usr/local/bin"        # Common on macOS
    BIN_NAME="$APP_NAME"
    ;;
  mingw*|msys*|cygwin*|windows_nt)
    OS="windows"
    INSTALL_DIR="$HOME/.local/bin"      # Arbitrary per-user location
    BIN_NAME="$APP_NAME.exe"
    ;;
  *)
    echo "Unsupported operating system: $UNAME_S"
    exit 1
    ;;
esac

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
  x86_64)
    ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Construct download URL
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$APP_NAME-$OS-$ARCH"
if [ "$OS" = "windows" ]; then
  # Binaries are often named with .exe for Windows
  DOWNLOAD_URL="$DOWNLOAD_URL.exe"
fi

# Download the binary
TEMP_FILE=$(mktemp)
echo "Downloading $APP_NAME from $DOWNLOAD_URL..."
curl -L -o "$TEMP_FILE" "$DOWNLOAD_URL"

# Make the binary executable on Linux/macOS
if [ "$OS" != "windows" ]; then
  chmod +x "$TEMP_FILE"
fi

# Move binary to final location
echo "Placing $APP_NAME in $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR" 2>/dev/null || mkdir -p "$INSTALL_DIR"
sudo mv "$TEMP_FILE" "$INSTALL_DIR/$BIN_NAME"

# Add bin directory to PATH if not already present (Linux/macOS)
if [ "$OS" != "windows" ]; then
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo "Appending $INSTALL_DIR to your PATH in ~/.bashrc..."
    {
      echo ""
      echo "# Added by $APP_NAME installer"
      echo "export PATH=\"$INSTALL_DIR:\$PATH\""
    } >> ~/.bashrc
    echo "Please reload your shell or run 'source ~/.bashrc' to update your PATH."
  fi
else
  echo "On Windows, consider adding $INSTALL_DIR to your PATH manually."
fi

echo "$APP_NAME installed successfully!"