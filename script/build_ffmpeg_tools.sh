#!/usr/bin/env bash
set -euo pipefail

FFMPEG_VERSION="8.1.2"
FFMPEG_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ARCH="$(/usr/bin/uname -m)"
SOURCE_ROOT="$ROOT_DIR/.build/ffmpeg-source"
SOURCE_ARCHIVE="$SOURCE_ROOT/ffmpeg-$FFMPEG_VERSION.tar.xz"
BUILD_ROOT="$ROOT_DIR/.build/ffmpeg-build/$ARCH"
TOOLS_ROOT="$ROOT_DIR/.build/ffmpeg-tools/$ARCH"
SOURCE_URL="https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"

case "$ARCH" in
  arm64|x86_64) ;;
  *) echo "unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
esac

if [[ -x "$TOOLS_ROOT/ffmpeg" && -x "$TOOLS_ROOT/ffprobe" ]]; then
  VERSION_OUTPUT="$($TOOLS_ROOT/ffmpeg -version 2>&1)"
  if [[ "$VERSION_OUTPUT" == *"ffmpeg version $FFMPEG_VERSION"* \
    && "$VERSION_OUTPUT" != *"--enable-gpl"* \
    && "$VERSION_OUTPUT" != *"--enable-nonfree"* ]]; then
    echo "$TOOLS_ROOT"
    exit 0
  fi
fi

/bin/mkdir -p "$SOURCE_ROOT" "$ROOT_DIR/.build/ffmpeg-build" "$ROOT_DIR/.build/ffmpeg-tools"
if [[ ! -f "$SOURCE_ARCHIVE" ]]; then
  /usr/bin/curl --fail --location --proto "=https" --tlsv1.2 "$SOURCE_URL" --output "$SOURCE_ARCHIVE.partial"
  /bin/mv "$SOURCE_ARCHIVE.partial" "$SOURCE_ARCHIVE"
fi

ACTUAL_SHA256="$(/usr/bin/shasum -a 256 "$SOURCE_ARCHIVE" | /usr/bin/awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$FFMPEG_SHA256" ]]; then
  echo "FFmpeg source checksum mismatch" >&2
  /bin/rm -f "$SOURCE_ARCHIVE"
  exit 1
fi

[[ ! -L "$BUILD_ROOT" && ! -L "$TOOLS_ROOT" ]] || { echo "unsafe FFmpeg build directory" >&2; exit 1; }
/bin/rm -rf "$BUILD_ROOT" "$TOOLS_ROOT"
/bin/mkdir -p "$BUILD_ROOT" "$TOOLS_ROOT"
/usr/bin/tar -xJf "$SOURCE_ARCHIVE" -C "$BUILD_ROOT" --strip-components=1

CONFIGURE_FLAGS=(
  "--prefix=$BUILD_ROOT/install"
  "--arch=$ARCH"
  "--target-os=darwin"
  "--cc=/usr/bin/clang"
  "--disable-autodetect"
  "--disable-debug"
  "--disable-doc"
  "--disable-ffplay"
  "--disable-network"
  "--disable-shared"
  "--enable-static"
  "--enable-pic"
  "--enable-pthreads"
  "--enable-audiotoolbox"
  "--enable-videotoolbox"
)

(
  cd "$BUILD_ROOT"
  ./configure "${CONFIGURE_FLAGS[@]}"
  JOBS="$(/usr/sbin/sysctl -n hw.logicalcpu 2>/dev/null || printf '4')"
  /usr/bin/make -j"$JOBS" ffmpeg ffprobe
)

/bin/cp "$BUILD_ROOT/ffmpeg" "$TOOLS_ROOT/ffmpeg"
/bin/cp "$BUILD_ROOT/ffprobe" "$TOOLS_ROOT/ffprobe"
/usr/bin/strip -x "$TOOLS_ROOT/ffmpeg" "$TOOLS_ROOT/ffprobe"
/bin/chmod 755 "$TOOLS_ROOT/ffmpeg" "$TOOLS_ROOT/ffprobe"
/bin/cp "$BUILD_ROOT/COPYING.LGPLv2.1" "$TOOLS_ROOT/COPYING.LGPLv2.1"
/bin/cp "$BUILD_ROOT/LICENSE.md" "$TOOLS_ROOT/LICENSE.md"
printf '%s\n' "${CONFIGURE_FLAGS[@]}" > "$TOOLS_ROOT/BUILD-CONFIG.txt"
printf '%s  %s\n' "$FFMPEG_SHA256" "ffmpeg-$FFMPEG_VERSION.tar.xz" > "$TOOLS_ROOT/SOURCE-SHA256.txt"

VERSION_OUTPUT="$($TOOLS_ROOT/ffmpeg -version 2>&1)"
[[ "$VERSION_OUTPUT" == *"ffmpeg version $FFMPEG_VERSION"* ]] || { echo "unexpected FFmpeg version" >&2; exit 1; }
[[ "$VERSION_OUTPUT" != *"--enable-gpl"* ]] || { echo "GPL FFmpeg build is not allowed" >&2; exit 1; }
[[ "$VERSION_OUTPUT" != *"--enable-nonfree"* ]] || { echo "non-free FFmpeg build is not allowed" >&2; exit 1; }

echo "$TOOLS_ROOT"
