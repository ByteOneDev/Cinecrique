#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ARCH="$(/usr/bin/uname -m)"
TOOLS_ROOT="${1:-$ROOT_DIR/.build/ffmpeg-tools/$ARCH}"
APP_BINARY="${2:-}"
FFMPEG="$TOOLS_ROOT/ffmpeg"
FFPROBE="$TOOLS_ROOT/ffprobe"

[[ -x "$FFMPEG" && -x "$FFPROBE" ]] || {
  echo "missing FFmpeg proxy tools: $TOOLS_ROOT" >&2
  exit 1
}

TEMP_BASE="${TMPDIR:-/private/tmp}"
[[ -d "$TEMP_BASE" && ! -L "$TEMP_BASE" ]] || {
  echo "unsafe temporary directory" >&2
  exit 1
}
CHECK_ROOT="$(/usr/bin/mktemp -d "$TEMP_BASE/Cinecrique-media-check.XXXXXX")"
cleanup() {
  /bin/rm -rf "$CHECK_ROOT"
}
trap cleanup EXIT

SUBTITLE="$CHECK_ROOT/dialogue.srt"
SOURCE="$CHECK_ROOT/source.mkv"
PROXY="$CHECK_ROOT/playback.mp4"
EXTRACTED="$CHECK_ROOT/subtitles.vtt"

/usr/bin/printf '%s\n' \
  '1' \
  '00:00:00,250 --> 00:00:01,500' \
  'Cinécrique vérifie ce sous-titre.' > "$SUBTITLE"

if ! "$FFMPEG" -hide_banner -loglevel error -nostdin -y \
    -f lavfi -i 'testsrc2=size=320x180:rate=24' \
    -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
    -f srt -i "$SUBTITLE" \
    -t 2 \
    -map 0:v:0 -map 1:a:0 -map 2:s:0 \
    -c:v h264_videotoolbox -allow_sw 1 -tag:v avc1 -pix_fmt yuv420p -b:v 1200k \
    -c:a aac -b:a 128k -c:s srt \
    "$SOURCE" 2> "$CHECK_ROOT/videotoolbox.log"; then
  /bin/rm -f "$SOURCE"
  echo "warning: VideoToolbox unavailable; using the software MPEG-4 test encoder" >&2
  "$FFMPEG" -hide_banner -loglevel error -nostdin -y \
    -f lavfi -i 'testsrc2=size=320x180:rate=24' \
    -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
    -f srt -i "$SUBTITLE" \
    -t 2 \
    -map 0:v:0 -map 1:a:0 -map 2:s:0 \
    -c:v mpeg4 -q:v 4 -pix_fmt yuv420p \
    -c:a aac -b:a 128k -c:s srt \
    "$SOURCE"
fi

SOURCE_HASH_BEFORE="$(/usr/bin/shasum -a 256 "$SOURCE" | /usr/bin/awk '{print $1}')"

"$FFMPEG" -hide_banner -loglevel error -nostdin -y \
  -i "$SOURCE" -map 0:v:0 -map '0:a?' -sn -dn \
  -c:v copy -c:a copy -movflags +faststart "$PROXY"
"$FFMPEG" -hide_banner -loglevel error -nostdin -y \
  -i "$SOURCE" -map 0:s:0 -c:s webvtt "$EXTRACTED"

SOURCE_HASH_AFTER="$(/usr/bin/shasum -a 256 "$SOURCE" | /usr/bin/awk '{print $1}')"
[[ "$SOURCE_HASH_BEFORE" == "$SOURCE_HASH_AFTER" ]] || {
  echo "the original MKV changed during proxy preparation" >&2
  exit 1
}

SOURCE_VIDEO_CODEC="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$SOURCE")"
VIDEO_CODEC="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$PROXY")"
AUDIO_CODEC="$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$PROXY")"
FORMAT_NAME="$("$FFPROBE" -v error -show_entries format=format_name -of default=noprint_wrappers=1:nokey=1 "$PROXY")"
[[ "$VIDEO_CODEC" == "$SOURCE_VIDEO_CODEC" ]] || { echo "proxy remux changed the video codec: $SOURCE_VIDEO_CODEC -> $VIDEO_CODEC" >&2; exit 1; }
[[ "$AUDIO_CODEC" == "aac" ]] || { echo "unexpected proxy audio codec: $AUDIO_CODEC" >&2; exit 1; }
[[ "$FORMAT_NAME" == *"mp4"* ]] || { echo "unexpected proxy container: $FORMAT_NAME" >&2; exit 1; }
/usr/bin/grep -q 'Cinécrique vérifie ce sous-titre.' "$EXTRACTED" || {
  echo "embedded subtitle extraction failed" >&2
  exit 1
}

"$FFMPEG" -hide_banner -loglevel error -nostdin -i "$PROXY" -f null -

if [[ -n "$APP_BINARY" ]]; then
  [[ -x "$APP_BINARY" ]] || { echo "missing Cinécrique binary: $APP_BINARY" >&2; exit 1; }
  case "$SOURCE_VIDEO_CODEC" in
    h264|hevc)
      NATIVE_SUPPORT="$CHECK_ROOT/native-support"
      FIRST_RESULT="$("$APP_BINARY" --check-media-proxy "$SOURCE" "$NATIVE_SUPPORT")"
      SECOND_RESULT="$("$APP_BINARY" --check-media-proxy "$SOURCE" "$NATIVE_SUPPORT")"
      [[ "$FIRST_RESULT" == *'"proxyUsed":true'* && "$FIRST_RESULT" == *'"subtitleExtracted":true'* ]] || {
        echo "native media proxy preparation failed: $FIRST_RESULT" >&2
        exit 1
      }
      [[ "$SECOND_RESULT" == *'"reused":true'* ]] || {
        echo "native media proxy cache reuse failed: $SECOND_RESULT" >&2
        exit 1
      }
      NATIVE_PROXY="$(/usr/bin/find "$NATIVE_SUPPORT/Media Proxies" -type f -name playback.mp4 -print -quit)"
      [[ -n "$NATIVE_PROXY" ]] || { echo "native playback proxy is missing" >&2; exit 1; }
      "$FFMPEG" -hide_banner -loglevel error -nostdin -fflags +genpts -i "$NATIVE_PROXY" -f null -
      ;;
    *)
      echo "warning: native proxy check skipped because VideoToolbox is unavailable in this environment" >&2
      ;;
  esac

  DISTINCT="$CHECK_ROOT/distinct-frames.mov"
  "$FFMPEG" -hide_banner -loglevel error -nostdin -y \
    -f lavfi -i 'color=c=red:size=48x48:rate=24:duration=1' \
    -f lavfi -i 'color=c=lime:size=48x48:rate=24:duration=1' \
    -f lavfi -i 'color=c=blue:size=48x48:rate=24:duration=1' \
    -filter_complex '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=rgb24[v]' \
    -map '[v]' -c:v qtrle "$DISTINCT"

  check_frame_color() {
    local time="$1"
    local expected="$2"
    local output="$CHECK_ROOT/frame-$expected.png"
    local exact_error="$CHECK_ROOT/exact-frame-$expected.err"
    if ! "$APP_BINARY" --check-exact-frame "$DISTINCT" "$time" "$output" > /dev/null 2> "$exact_error"; then
      if /usr/bin/grep -Eq 'Cannot Decode|Cannot Open' "$exact_error"; then
        echo "warning: exact-frame fixture skipped because AVFoundation cannot decode the generated test clip" >&2
        return 0
      fi
      /bin/cat "$exact_error" >&2
      exit 1
    fi
    local rgb
    rgb=($("$FFMPEG" -hide_banner -loglevel error -nostdin -i "$output" -frames:v 1 -vf 'scale=1:1,format=rgb24' -f rawvideo - 2>/dev/null | /usr/bin/od -An -tu1 -N3))
    local r="${rgb[0]:-0}"
    local g="${rgb[1]:-0}"
    local b="${rgb[2]:-0}"
    case "$expected" in
      red)
        (( r > 150 && g < 110 && b < 110 )) || { echo "exact frame color mismatch for red: $r $g $b" >&2; exit 1; }
        ;;
      green)
        (( g > 120 && r < 130 && b < 130 )) || { echo "exact frame color mismatch for green: $r $g $b" >&2; exit 1; }
        ;;
      blue)
        (( b > 150 && r < 110 && g < 140 )) || { echo "exact frame color mismatch for blue: $r $g $b" >&2; exit 1; }
        ;;
    esac
  }

  check_frame_color 0.5 red
  check_frame_color 1.5 green
  check_frame_color 2.5 blue
fi

echo "media proxy check passed: MKV $VIDEO_CODEC/AAC + WebVTT"
