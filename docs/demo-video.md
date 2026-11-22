# The walkthrough video

`npm run demo` makes `demo/out/agent-hq-demo.mp4`, a narrated 1080p walkthrough of Agent HQ (about 4½ minutes): install and connect, role defaults, opening a project, a full plan → approve → run → review, who picks each model (with every rule in order), Settings → Models and routing, Magpie account routing, juniors and mentors, permissions and reports.

It costs nothing to make. The app is driven with scripted providers, exactly like the e2e tests, so no model is called and no credit is used.

## How it is made

| Step | Tool | Output |
| --- | --- | --- |
| 1. Capture | Playwright (`tests/demo/capture.spec.ts`) walks the real built app and saves 2× stills plus where each click lands | `demo/public/shots/` |
| 2. Narrate | [edge-tts](https://github.com/rany2/edge-tts), Microsoft Edge's free neural voices; one clip per sentence, cached | `demo/public/voice/` |
| 3. Animate | [Remotion](https://www.remotion.dev) (React): title, task flow, team chart, the model-decision ladder, camera zooms, an animated cursor with click ripples, subtitles | `demo/out/render.mp4` |
| 4. Finish | ffmpeg normalises loudness to −16 LUFS | `demo/out/agent-hq-demo.mp4` |

Scenes are timed to the narration, so changing a sentence changes the timing of its animation automatically.

## Requirements

- `ffmpeg`: `sudo apt install ffmpeg` (Fedora: `sudo dnf install ffmpeg`)
- `edge-tts`: `uv tool install edge-tts` (or `pipx install edge-tts`). It needs an internet connection; only the narration text is sent.
- The demo's own packages install on the first run (`demo/node_modules`, separate from the app).

## Changing it

- **Words:** edit `lines` in `demo/src/scenes.json`, then `npm run demo`. Only changed sentences are narrated again.
- **What is shown:** each `shots` scene lists `steps`: the still (`shot`), the sentence it starts on (`at`), an optional `action` (`click` or `point`, which moves the cursor to the element recorded for that still) and `zoom` (move the camera onto the recorded region). The stills and their targets come from `tests/demo/capture.spec.ts`.
- **Voice:** `DEMO_VOICE=en-US-AvaNeural npm run demo`. List voices with `edge-tts --list-voices` (Arabic, for example: `ar-EG-SalmaNeural`, `ar-SA-HamedNeural`).
- **Preview while editing:** `cd demo && npm run studio` opens Remotion Studio with a timeline and scrubbing.

Remotion is free for individuals and companies of up to three people; larger companies need a [company license](https://www.remotion.dev/license).
