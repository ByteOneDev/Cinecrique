#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Cinécrique"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT_DIR/resources/macos/Info.plist")"
OUTPUT_APP="$ROOT_DIR/dist/$APP_NAME.app"
OUTPUT_DMG="$ROOT_DIR/dist/$APP_NAME-$VERSION.dmg"
CHECKSUM_FILE="$OUTPUT_DMG.sha256"
TEMP_BASE="${TMPDIR:-/private/tmp}"

if [[ "${1:-}" != "--skip-build" ]]; then
  "$ROOT_DIR/scripts/build_and_run.sh" --build
fi

[[ -d "$OUTPUT_APP" && ! -L "$OUTPUT_APP" ]] || { echo "application bundle missing: $OUTPUT_APP" >&2; exit 1; }

STAGING_ROOT="$(/usr/bin/mktemp -d "$TEMP_BASE/Cinecrique-DMG.XXXXXX")"
trap '/bin/rm -rf "$STAGING_ROOT"' EXIT
STAGING_DIR="$STAGING_ROOT/$APP_NAME $VERSION"
/bin/mkdir -p "$STAGING_DIR"
/usr/bin/ditto --norsrc "$OUTPUT_APP" "$STAGING_DIR/$APP_NAME.app"
/usr/bin/xattr -cr "$STAGING_DIR/$APP_NAME.app"
/usr/bin/codesign --verify --deep --strict "$STAGING_DIR/$APP_NAME.app"
/bin/ln -s /Applications "$STAGING_DIR/Applications"

[[ ! -L "$OUTPUT_DMG" && ! -L "$CHECKSUM_FILE" ]] || { echo "refusing to replace a symlinked artifact" >&2; exit 1; }
/bin/rm -f "$OUTPUT_DMG" "$CHECKSUM_FILE"
/usr/bin/hdiutil create \
  -volname "$APP_NAME $VERSION" \
  -srcfolder "$STAGING_DIR" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  "$OUTPUT_DMG"
/usr/bin/hdiutil verify "$OUTPUT_DMG"
DMG_HASH="$(/usr/bin/shasum -a 256 "$OUTPUT_DMG" | /usr/bin/awk '{print $1}')"
printf '%s  %s\n' "$DMG_HASH" "$(/usr/bin/basename "$OUTPUT_DMG")" > "$CHECKSUM_FILE"

echo "$OUTPUT_DMG"
echo "$CHECKSUM_FILE"
