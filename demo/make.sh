#!/usr/bin/env bash
# Builds the Agent HQ video series: 00 overview plus the recorded tutorials 01-06.
# Usage (from the repo root):
#   npm run demo                 everything
#   npm run demo -- overview     only the overview
#   npm run demo -- 03-auto      only one tutorial (any id from demo/src/series/episodes.json)
#   DEMO_VOICE=en-US-AvaNeural npm run demo     another Edge voice (edge-tts --list-voices)
#   DEMO_CONCURRENCY=4 npm run demo             more render workers if you have the RAM
set -euo pipefail
cd "$(dirname "$0")/.."

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing: $1. Install it with: $2" >&2
    exit 1
  fi
}
need ffmpeg "sudo apt install ffmpeg   (Fedora: sudo dnf install ffmpeg)"
need edge-tts "uv tool install edge-tts   (or: pipx install edge-tts)"

[ -d demo/node_modules ] || (cd demo && npm ci --no-audit --no-fund)

only="${1:-all}"
episodes=$(node -e "for (const e of require('./demo/src/series/episodes.json').episodes) console.log(e.id)")
if [ "$only" != all ] && [ "$only" != overview ] && ! grep -qx "$only" <<<"$episodes"; then
  echo "Unknown video: $only. Use overview or one of:" >&2
  echo "$episodes" >&2
  exit 1
fi

jobs="${DEMO_CONCURRENCY:-3}"
mkdir -p demo/out/episodes

echo "1/4 Narrating (clips are cached, so only changed lines are voiced)"
(cd demo && node scripts/voice.mjs)

echo "2/4 Building the app"
npm run build >/dev/null

echo "3/4 Recording the app with scripted model replies (no credit is used)"
case "$only" in
  all) spec="" ;;
  overview) spec="overview-stills" ;;
  *) spec="$only" ;;
esac
AGENT_HQ_E2E_BUILT=1 npx playwright test -c playwright.demo.config.ts $spec --workers=1 --reporter=line

echo "4/4 Rendering"
# Every video is rendered as a 4K master, so the app recording is never enlarged, then supersampled to a sharp 1080p.
render() { # render <composition> <output name>
  (cd demo && npx remotion render src/index.ts "$1" "out/$2.render.mp4" --scale=2 --codec h264 --crf 10 --x264-preset slow --image-format png --concurrency="$jobs" --log=error)
  ffmpeg -loglevel error -y -i "demo/out/$2.render.mp4" -c:v libx264 -preset slow -crf 14 -tune stillimage -pix_fmt yuv420p \
    -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k -movflags +faststart "demo/out/$2.4k.mp4"
  ffmpeg -loglevel error -y -i "demo/out/$2.4k.mp4" -vf scale=1920:1080:flags=lanczos -c:v libx264 -preset slow -crf 12 -tune stillimage -pix_fmt yuv420p \
    -c:a copy -movflags +faststart "demo/out/$2.mp4"
  rm -f "demo/out/$2.render.mp4"
  echo "  -> demo/out/$2.mp4 (1080p) and demo/out/$2.4k.mp4 (4K)"
}
if [ "$only" = all ] || [ "$only" = overview ]; then
  render Overview "00-overview"
fi
for id in $episodes; do
  if [ "$only" = all ] || [ "$only" = "$id" ]; then
    render "Episode-$id" "episodes/$id"
  fi
done
echo "Done. Videos are in demo/out/ (00-overview.mp4) and demo/out/episodes/."
