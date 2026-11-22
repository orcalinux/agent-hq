# Master prompt: narrated product videos with Claude Code

Paste the prompt below into Claude Code (or Codex) in the root of any project. Replace everything in `{{double braces}}`. It makes the agent build the same kind of video as Agent HQ's walkthrough: real screenshots of the real app, animated scenes, a neural voice, subtitles, and loudness-normalised MP4 output, at no model cost.

## What was used to make the Agent HQ video

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Capture | Playwright drives the built app with scripted providers (no real model calls, no credit) and saves 2x stills plus the click target of each | `tests/demo/capture.spec.ts`, `playwright.demo.config.ts`, output `demo/public/shots/` |
| Script | One JSON file: voice, speaking rate, scenes, one sentence per line, which still each sentence shows, optional `click`/`point`/`zoom` | `demo/src/scenes.json` |
| Voice | `edge-tts` CLI (free Microsoft neural voices), one cached clip per sentence, 2 at a time, retries | `demo/scripts/voice.mjs`, output `demo/public/voice/` |
| Animation | Remotion 4 (React): title, flow, team, decision ladder, outro, screenshot scenes with camera zoom, animated cursor, click ripples, subtitles | `demo/src/` (`Demo.tsx`, `scenes/`, `components/`, `theme.ts`, `timeline.ts`) |
| Finish | ffmpeg `loudnorm` to -16 LUFS, AAC 160k, faststart | `demo/make.sh` |
| Run | One command builds, captures, narrates, renders and finishes | `npm run demo` |
| Guide | How to change words, voice and scenes | `docs/demo-video.md` |

Tools to install once:

```bash
sudo apt install ffmpeg            # Fedora: sudo dnf install ffmpeg
uv tool install edge-tts           # or: pipx install edge-tts
npx playwright install chromium
```

Claude Code skills that help (already installed on this machine under `~/.claude/skills` and `~/.agents/skills`): `explainer-video`, `remotion-best-practices`, `remotion-create`, `remotion-markup`, `remotion-captions`, `remotion-studio`, `remotion-render`, `remotion-multimedia`, `remotion-docs`, and the other `remotion-*` skills. Remotion is free for individuals and companies of up to three people.

Language note: narration voice is chosen with `DEMO_VOICE`. English: `en-US-AndrewNeural`, `en-US-AvaNeural`. Arabic: `ar-EG-SalmaNeural`, `ar-SA-HamedNeural`. List all with `edge-tts --list-voices`. If the Microsoft library endpoint returns 403, keep using the `edge-tts` CLI.

## The master prompt

```text
You are a product-video director and engineer. Build a narrated walkthrough video of {{PRODUCT NAME}} and make it reproducible with one command.

GOAL
- Audience: {{who watches, e.g. first-time users}}. They should be able to {{outcome, e.g. install, connect, and finish a first task}} after watching.
- Length: {{4 to 5}} minutes, 1920x1080, 30 fps, MP4 (H.264 + AAC).
- Language and voice: {{English, en-US-AndrewNeural}}. Tone: calm, direct, no hype, no filler.
- Story order: what it is -> how a task flows -> the main parts -> step-by-step setup -> one full real task -> the advanced controls -> where to get help.

HARD RULES
1. Show the real product. Never mock screens. Capture stills from the real built app with Playwright (or the platform's equivalent), 2x device scale, using scripted or fake backends so no paid API is called and no credit is used.
2. Record, for every still, the bounding box of the element that gets clicked, so the animated cursor lands on it exactly.
3. Never show private data: emails, tokens, API keys, home paths of other people. Use seeded demo data.
4. One sentence per narration line. Each line is narrated as its own clip and cached by hash of (voice, rate, text), so editing one sentence re-narrates only that sentence.
5. Scene length comes from the narration length. Never hard-code seconds.
6. Every visual change must start on the sentence that explains it.
7. Prefer motion that explains: camera zoom onto the relevant region, a cursor with click ripple, a highlighted control. No decoration.
8. Subtitles on, matching the spoken sentence exactly. Safe margins. High contrast.
9. Final audio normalised to -16 LUFS, true peak -1.5.
10. Everything runs from one command ({{npm run demo}}), fails with a clear message if ffmpeg or edge-tts is missing, and writes only to a git-ignored output folder.

ARCHITECTURE (create these)
- tests/demo/capture.spec.ts + playwright.demo.config.ts : walks the app, saves demo/public/shots/*.png and shots/manifest.json (name -> click target box).
- demo/package.json : separate Remotion project (remotion, @remotion/cli, @remotion/transitions, react, react-dom, @remotion/google-fonts, typescript). Pin one Remotion version for all @remotion/* packages.
- demo/src/scenes.json : { voice, rate, scenes: [{ id, kind: title|flow|team|shots|ladder|outro, chapter, lines[], steps[{ shot, at, action: click|point, zoom }] }] }.
- demo/scripts/voice.mjs : narrates every line with the edge-tts CLI, 2 in parallel, up to 8 retries with backoff, caches by hash, writes durations with ffprobe.
- demo/src/ : Demo.tsx (sequences scenes from durations), scenes/, components/ (Cursor, Subtitles, Camera, Chapter title), theme.ts matching the product's real colours and font.
- demo/make.sh : build -> capture -> narrate -> render -> loudnorm. Prints 4 numbered progress steps.
- docs/demo-video.md : how to change words, voice, and scenes; requirements.

SCENES TO WRITE FOR {{PRODUCT NAME}}
1. Title: what it is in one sentence.
2. Flow: the path of one task in three beats.
3. Team or parts: who or what does what.
4. Setup steps: one scene per step, with a click and a zoom.
5. One full real task from request to result.
6. Advanced controls: {{list: routing, permissions, reports, settings}}.
7. Outro: where to download, docs link, how to get help.
Write the narration first, show it to me, and wait for my OK before rendering.

QUALITY CHECKS BEFORE YOU SAY DONE
- Render a still of every scene (npx remotion still) and look at each: no clipped text, no cursor off target, no empty frames.
- Play the sentence boundaries: no narration cut off, no visual change before its sentence.
- ffprobe the final file: 1920x1080, 30 fps, audio present, about -16 LUFS.
- Run the whole pipeline from a clean checkout once to prove it is reproducible.
- Report the output path, duration, file size, and anything you could not verify.

DELIVERABLE
The MP4 at {{demo/out/product-demo.mp4}} plus a copy in ~/Videos, and the files above committed on a branch I name. Do not publish or upload the video anywhere without asking.
```

## Variants

- **Arabic narration:** add `Voice: ar-EG-SalmaNeural, write the narration in Egyptian Arabic, set subtitles right-to-left`, and run `DEMO_VOICE=ar-EG-SalmaNeural npm run demo`.
- **60-second teaser:** replace the length line with `Length: 60 seconds, 6 scenes, no setup steps, end on the download link.`
- **Real run, real credit:** replace rule 1 with `Use the real provider for one task and cap it at {{N}} dollars`. Only do this when you accept the cost.
- **Per-release video:** add `Reuse demo/ and only update scenes.json and the capture steps for what changed in this release.`
