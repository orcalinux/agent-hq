#!/usr/bin/env bash
# Builds the Agent HQ walkthrough video: real app stills -> narration -> animated render.
# Usage: npm run demo            (from the repo root)
#        DEMO_VOICE=en-US-AvaNeural npm run demo   (another Edge voice; list them with: edge-tts --list-voices)
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

echo "1/4 Building the app"
npm run build >/dev/null

echo "2/4 Capturing the app with scripted providers (no credit is used)"
AGENT_HQ_E2E_BUILT=1 npx playwright test -c playwright.demo.config.ts --reporter=line

echo "3/4 Narrating"
(cd demo && node scripts/voice.mjs)

echo "4/4 Rendering"
(cd demo && npx remotion render src/index.ts AgentHQDemo out/render.mp4 --codec h264 --crf 18 --log=error)
ffmpeg -loglevel error -y -i demo/out/render.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 160k -movflags +faststart demo/out/agent-hq-demo.mp4
echo "Done: demo/out/agent-hq-demo.mp4"
