#!/bin/sh
set -e

REPO="vincelwt/gloomberb"
INSTALL_DIR="${GLOOMBERB_INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# macOS x64 uses arm64 binary (runs via Rosetta 2)
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
  arch="arm64"
fi

ASSET="gloomberb-${os}-${arch}.gz"

# Get latest release download URL
echo "Fetching latest release..."
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

# Download
TMP="$(mktemp)"
echo "Downloading ${ASSET}..."
if command -v curl >/dev/null 2>&1; then
  curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$TMP"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress "$DOWNLOAD_URL" -O "$TMP"
else
  echo "Error: curl or wget required"
  exit 1
fi

# Decompress
echo "Extracting..."
mv "$TMP" "$TMP.gz"
gunzip "$TMP.gz"
chmod +x "$TMP"
mkdir -p "$INSTALL_DIR"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "$INSTALL_DIR/gloomberb"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMP" "$INSTALL_DIR/gloomberb"
fi

echo "Installed gloomberb to ${INSTALL_DIR}/gloomberb"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Warning: $INSTALL_DIR is not in your PATH. Add it with:"
     echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac

echo "Run 'gloomberb' to start."
