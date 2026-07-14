#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Cinécrique"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PLIST="$ROOT_DIR/macOS/Resources/Info.plist"
APP="$ROOT_DIR/dist/$APP_NAME.app"
ZIP="$ROOT_DIR/dist/$APP_NAME.zip"
MODE="${1:-full}"
FFMPEG_VERSION="8.1.2"

case "$MODE" in
  full|--artifacts-only)
    ;;
  *)
    echo "usage: $0 [--artifacts-only]" >&2
    exit 2
    ;;
esac

cd "$ROOT_DIR"

PACKAGE_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
PLIST_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")"
[[ "$PACKAGE_VERSION" == "$PLIST_VERSION" ]] || {
  echo "version mismatch: package.json=$PACKAGE_VERSION Info.plist=$PLIST_VERSION" >&2
  exit 1
}

/usr/bin/plutil -lint "$PLIST"

if [[ "$MODE" == "full" ]]; then
  CINECRIQUE_DISABLE_SWIFTPM_SANDBOX=1 "$ROOT_DIR/script/build_and_run.sh" --build
  "$ROOT_DIR/script/create_dmg.sh" --skip-build
fi

DMG="$ROOT_DIR/dist/$APP_NAME-$PLIST_VERSION.dmg"
CHECKSUM="$DMG.sha256"
FFMPEG_SOURCE="$ROOT_DIR/dist/ffmpeg-$FFMPEG_VERSION-source.tar.xz"
FFMPEG_SOURCE_CHECKSUM="$FFMPEG_SOURCE.sha256"

[[ -d "$APP" && ! -L "$APP" ]] || { echo "missing app bundle: $APP" >&2; exit 1; }
[[ -f "$ZIP" && ! -L "$ZIP" ]] || { echo "missing app archive: $ZIP" >&2; exit 1; }
[[ -f "$DMG" && ! -L "$DMG" ]] || { echo "missing disk image: $DMG" >&2; exit 1; }
[[ -f "$CHECKSUM" && ! -L "$CHECKSUM" ]] || { echo "missing checksum: $CHECKSUM" >&2; exit 1; }
[[ -f "$FFMPEG_SOURCE" && ! -L "$FFMPEG_SOURCE" ]] || { echo "missing FFmpeg source archive" >&2; exit 1; }
[[ -f "$FFMPEG_SOURCE_CHECKSUM" && ! -L "$FFMPEG_SOURCE_CHECKSUM" ]] || { echo "missing FFmpeg source checksum" >&2; exit 1; }

TEMP_BASE="${TMPDIR:-/private/tmp}"
[[ -d "$TEMP_BASE" && ! -L "$TEMP_BASE" ]] || { echo "unsafe temporary directory" >&2; exit 1; }
PACKAGE_CHECK_ROOT="$(/usr/bin/mktemp -d "$TEMP_BASE/Cinecrique-release-check.XXXXXX")"
MOUNT_POINT="$PACKAGE_CHECK_ROOT/dmg"
DMG_ATTACHED=0
cleanup() {
  if [[ "$DMG_ATTACHED" == "1" ]]; then
    /usr/bin/hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  /bin/rm -rf "$PACKAGE_CHECK_ROOT"
}
trap cleanup EXIT
/bin/mkdir -p "$PACKAGE_CHECK_ROOT/app-copy"
/usr/bin/ditto --norsrc "$APP" "$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app"
/usr/bin/xattr -cr "$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app"
/usr/bin/codesign --verify --deep --strict "$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app"
if /usr/bin/strings "$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app/Contents/MacOS/Cinecrique" | /usr/bin/grep -E '/(opt/homebrew|usr/local|opt/local)/bin/ff(mpeg|probe)' >/dev/null; then
  echo "release binary contains external FFmpeg fallback paths" >&2
  exit 1
fi
PACKAGE_FFMPEG="$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app/Contents/Resources/Tools/ffmpeg"
[[ -x "$PACKAGE_FFMPEG" ]] || { echo "bundled FFmpeg is missing" >&2; exit 1; }
PACKAGE_FFMPEG_VERSION="$($PACKAGE_FFMPEG -version 2>&1)"
[[ "$PACKAGE_FFMPEG_VERSION" == *"ffmpeg version $FFMPEG_VERSION"* ]] || { echo "bundled FFmpeg version mismatch" >&2; exit 1; }
[[ "$PACKAGE_FFMPEG_VERSION" != *"--enable-gpl"* && "$PACKAGE_FFMPEG_VERSION" != *"--enable-nonfree"* ]] || { echo "bundled FFmpeg has forbidden license flags" >&2; exit 1; }
[[ -f "$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app/Contents/Resources/Tools/COPYING.LGPLv2.1" ]] || { echo "FFmpeg LGPL notice is missing" >&2; exit 1; }
"$ROOT_DIR/script/check_media_proxy.sh" \
  "$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app/Contents/Resources/Tools" \
  "$PACKAGE_CHECK_ROOT/app-copy/$APP_NAME.app/Contents/MacOS/Cinecrique"
/bin/mkdir -p "$PACKAGE_CHECK_ROOT/zip-copy"
/usr/bin/ditto -x -k "$ZIP" "$PACKAGE_CHECK_ROOT/zip-copy"
/usr/bin/codesign --verify --deep --strict "$PACKAGE_CHECK_ROOT/zip-copy/$APP_NAME.app"
/usr/bin/hdiutil verify "$DMG"
/bin/mkdir -p "$MOUNT_POINT"
/usr/bin/hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_POINT" "$DMG" >/dev/null
DMG_ATTACHED=1
[[ -d "$MOUNT_POINT/$APP_NAME.app" ]] || { echo "app missing from disk image" >&2; exit 1; }
[[ -L "$MOUNT_POINT/Applications" ]] || { echo "Applications shortcut missing from disk image" >&2; exit 1; }
/usr/bin/codesign --verify --deep --strict "$MOUNT_POINT/$APP_NAME.app"
"$MOUNT_POINT/$APP_NAME.app/Contents/Resources/Tools/ffprobe" -version >/dev/null
MOUNTED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$MOUNT_POINT/$APP_NAME.app/Contents/Info.plist")"
[[ "$MOUNTED_VERSION" == "$PLIST_VERSION" ]] || { echo "disk image version mismatch" >&2; exit 1; }
/usr/bin/hdiutil detach "$MOUNT_POINT" >/dev/null
DMG_ATTACHED=0

EXPECTED_HASH="$(/usr/bin/awk '{print $1}' "$CHECKSUM")"
ACTUAL_HASH="$(/usr/bin/shasum -a 256 "$DMG" | /usr/bin/awk '{print $1}')"
[[ "$EXPECTED_HASH" == "$ACTUAL_HASH" ]] || {
  echo "checksum mismatch for $DMG" >&2
  exit 1
}
EXPECTED_SOURCE_HASH="$(/usr/bin/awk '{print $1}' "$FFMPEG_SOURCE_CHECKSUM")"
ACTUAL_SOURCE_HASH="$(/usr/bin/shasum -a 256 "$FFMPEG_SOURCE" | /usr/bin/awk '{print $1}')"
[[ "$EXPECTED_SOURCE_HASH" == "$ACTUAL_SOURCE_HASH" ]] || {
  echo "checksum mismatch for $FFMPEG_SOURCE" >&2
  exit 1
}

SIGNING_SUMMARY="$(/usr/bin/codesign -dv --verbose=2 "$APP" 2>&1 || true)"
if [[ "$SIGNING_SUMMARY" == *"Signature=adhoc"* ]]; then
  echo "warning: ad hoc signature; use a Developer ID identity and notarize before public distribution" >&2
fi

cleanup
trap - EXIT

echo "release check passed: $APP_NAME $PLIST_VERSION"
echo "$DMG"
echo "$CHECKSUM"
echo "$FFMPEG_SOURCE"
echo "$FFMPEG_SOURCE_CHECKSUM"
