#!/bin/sh
# omd installer — download the omd distribution tarball from GitHub Releases
# and unpack it. Usage:
#
#   curl -fsSL https://raw.githubusercontent.com/WilliamCodeBox/oh-my-dsh/main/install.sh | sh
#   curl -fsSL ... | sh -s -- 0.1.0-rc.9          # pin a version
#   OMD_HOME=/opt/omd curl -fsSL ... | sh         # override install dir
#
# The tarball contains the bun runtime (GLIBC_2.17 — CentOS 7+ compatible)
# plus the deployed closure tree; no system dependencies beyond libc.
set -e

REPO="${OMD_REPO:-WilliamCodeBox/oh-my-dsh}"
VERSION="${1:-latest}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | amd64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *)
    echo "omd: unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
fi
if [ -z "$VERSION" ]; then
  echo "omd: could not resolve the latest release tag" >&2
  exit 1
fi
# Release tags are `omd-v<version>`; accept a bare version for pinning.
case "$VERSION" in
  omd-v*) : ;;
  *) VERSION="omd-v$VERSION" ;;
esac

DEST="${OMD_HOME:-$HOME/.local/share/omd}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Optional GitHub mirror prefix for restricted networks, e.g.
#   GH_PROXY=https://gh-proxy.com/ sh install.sh
# Prepended verbatim to the download URL.
PROXY="${GH_PROXY:-}"

URL="${PROXY}https://github.com/$REPO/releases/download/$VERSION/omd-dist-$ARCH.tar.gz"
echo "omd: downloading $URL"
curl -fsSL --retry 3 --retry-delay 2 "$URL" -o "$TMP/omd-dist.tar.gz"
mkdir -p "$DEST"
# Replace, don't merge: tar extraction over a previous install leaves
# orphaned store entries behind (observed: 143M rc.7 + 150M rc.8 stacking).
rm -rf "$DEST"/*
tar xzf "$TMP/omd-dist.tar.gz" -C "$DEST"
chmod +x "$DEST/omd"

echo
echo "omd $VERSION installed at $DEST/omd"
echo "add it to your PATH:"
echo "  export PATH=\"$DEST:\$PATH\""
case ":$PATH:" in
  *":$DEST:"*) : ;;
  *) echo "(or run it as $DEST/omd)" ;;
esac
