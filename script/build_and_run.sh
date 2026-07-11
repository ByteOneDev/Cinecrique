#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Cinécrique"
EXECUTABLE_NAME="Cinecrique"
BUNDLE_ID="app.analyse.local"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT_APP="$ROOT_DIR/dist/$APP_NAME.app"
OUTPUT_ARCHIVE="$ROOT_DIR/dist/$APP_NAME.zip"
TEMP_BASE_INPUT="${TMPDIR:-/private/tmp}"
if [[ ! -d "$TEMP_BASE_INPUT" || -L "$TEMP_BASE_INPUT" || ! -O "$TEMP_BASE_INPUT" ]]; then
  echo "unsafe temporary directory: $TEMP_BASE_INPUT" >&2
  exit 1
fi
TEMP_BASE="$(cd "$TEMP_BASE_INPUT" && pwd -P)"
RUNTIME_ROOT="${TEMP_BASE%/}/$BUNDLE_ID-runtime"
APP_BUNDLE="$RUNTIME_ROOT/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/$EXECUTABLE_NAME"
LEGACY_APP_BINARY="${TEMP_BASE%/}/app.analyse.local-runtime/Analyse.app/Contents/MacOS/Analyse"

export COPYFILE_DISABLE=1
export CLANG_MODULE_CACHE_PATH="$ROOT_DIR/.build/ModuleCache"
export SWIFTPM_MODULECACHE_OVERRIDE="$ROOT_DIR/.build/ModuleCache"

SWIFT_PACKAGE_ARGS=(--scratch-path "$ROOT_DIR/.build")
if [[ "${CINECRIQUE_DISABLE_SWIFTPM_SANDBOX:-0}" == "1" ]]; then
  SWIFT_PACKAGE_ARGS+=(--disable-sandbox)
fi

command_is_managed() {
  local command="$1"
  [[ "$command" == "$RUNTIME_ROOT/"*"/Contents/MacOS/$EXECUTABLE_NAME" \
    || "$command" == "$ROOT_DIR/dist/"*"/Contents/MacOS/$EXECUTABLE_NAME" \
    || "$command" == "$LEGACY_APP_BINARY" ]]
}

app_is_running() {
  local pid command
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if command_is_managed "$command"; then
      return 0
    fi
  done < <(pgrep -x "$EXECUTABLE_NAME" 2>/dev/null || true)
  return 1
}

stop_app() {
  local process_name pid command
  for process_name in "$EXECUTABLE_NAME" "Analyse"; do
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      if command_is_managed "$command"; then
        kill "$pid" 2>/dev/null || true
      fi
    done < <(pgrep -x "$process_name" 2>/dev/null || true)
  done
}

stop_app

cd "$ROOT_DIR"
npm test
npm run build
swift build "${SWIFT_PACKAGE_ARGS[@]}"
swift run "${SWIFT_PACKAGE_ARGS[@]}" AnalyseCoreChecks

BUILD_BINARY="$(swift build "${SWIFT_PACKAGE_ARGS[@]}" --show-bin-path)/$EXECUTABLE_NAME"
[[ -x "$BUILD_BINARY" ]] || { echo "missing app binary: $BUILD_BINARY" >&2; exit 1; }

[[ ! -L "$APP_BUNDLE" && ! -L "$OUTPUT_APP" && ! -L "$OUTPUT_ARCHIVE" ]] || { echo "refusing to replace a symlinked build artifact" >&2; exit 1; }
rm -rf "$APP_BUNDLE" "$OUTPUT_APP" "$OUTPUT_ARCHIVE"
mkdir -p "$RUNTIME_ROOT"
chmod 700 "$RUNTIME_ROOT"
mkdir -p "$APP_MACOS" "$APP_RESOURCES/WebApp"
cp "$BUILD_BINARY" "$APP_BINARY"
cp "$ROOT_DIR/macOS/Resources/Info.plist" "$APP_CONTENTS/Info.plist"
cp -R "$ROOT_DIR/web-dist/." "$APP_RESOURCES/WebApp/"
if [[ -f "$ROOT_DIR/macOS/Resources/Cinecrique.icns" ]]; then
  cp "$ROOT_DIR/macOS/Resources/Cinecrique.icns" "$APP_RESOURCES/Cinecrique.icns"
fi
chmod +x "$APP_BINARY"
find "$APP_RESOURCES/WebApp" -name .DS_Store -delete
[[ -f "$APP_RESOURCES/WebApp/index.html" ]] || { echo "missing bundled web app" >&2; exit 1; }

xattr -cr "$APP_BUNDLE"
/usr/bin/codesign --force --deep --options runtime --sign - --timestamp=none "$APP_BUNDLE"
xattr -cr "$APP_BUNDLE"
/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
mkdir -p "$(dirname "$OUTPUT_APP")"
/usr/bin/ditto -c -k --keepParent --norsrc "$APP_BUNDLE" "$OUTPUT_ARCHIVE"

PACKAGE_CHECK_ROOT="$RUNTIME_ROOT/package-check"
rm -rf "$PACKAGE_CHECK_ROOT"
mkdir -p "$PACKAGE_CHECK_ROOT"
/usr/bin/ditto -x -k "$OUTPUT_ARCHIVE" "$PACKAGE_CHECK_ROOT"
/usr/bin/codesign --verify --deep --strict "$PACKAGE_CHECK_ROOT/$APP_NAME.app"
rm -rf "$PACKAGE_CHECK_ROOT"

open_app() {
  xattr -cr "$APP_BUNDLE"
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --build|build)
    echo "$OUTPUT_ARCHIVE"
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$EXECUTABLE_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    for _ in {1..20}; do
      if app_is_running; then
        echo "verified: $APP_NAME is running"
        exit 0
      fi
      sleep 0.25
    done
    echo "verification failed: $APP_NAME is not running" >&2
    exit 1
    ;;
  *)
    echo "usage: $0 [run|--build|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
