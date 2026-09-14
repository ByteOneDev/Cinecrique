#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT_DIR/resources/macos/Info.plist")"
DMG_PATH="${1:-$ROOT_DIR/dist/Cinécrique-$VERSION.dmg}"
PROFILE="${CINECRIQUE_NOTARY_PROFILE:-}"

[[ -f "$DMG_PATH" && ! -L "$DMG_PATH" ]] || { echo "DMG missing: $DMG_PATH" >&2; exit 1; }
[[ -n "$PROFILE" ]] || { echo "set CINECRIQUE_NOTARY_PROFILE to an xcrun notarytool keychain profile" >&2; exit 1; }

/usr/bin/xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait
/usr/bin/xcrun stapler staple "$DMG_PATH"
/usr/bin/xcrun stapler validate "$DMG_PATH"
echo "$DMG_PATH"
