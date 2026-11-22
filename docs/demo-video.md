# The video series

`npm run demo` makes the Agent HQ videos: one narrated overview and six recorded tutorials, each in sharp 1080p and in 4K, with narration and captions. Watch them in this order:

| # | File | What it shows |
| --- | --- | --- |
| 00 | `demo/out/00-overview.mp4` | What Agent HQ is: the team, the task flow, who picks each model, permissions and reports. Animated, about 5 minutes. |
| 01 | `demo/out/episodes/01-setup.mp4` | **Set up.** Connect a provider through its signed-in CLI, give every role a model, open a project. |
| 02 | `demo/out/episodes/02-manual.mp4` | **Manual mode.** Ask Sovereign, review the plan (levels, models, dependencies), approve, then compare, apply, undo and discard each file. |
| 03 | `demo/out/episodes/03-auto.mp4` | **Auto mode.** Auto-apply writes QA-approved files for you; Full access lets build requests start without approval. Checks the result on disk and undoes a change. |
| 04 | `demo/out/episodes/04-models.mp4` | **Models and routing.** Automatic model per complexity level, pinning a level, forcing one model, locking an agent, Magpie account groups, the ranking and the decision log. |
| 05 | `demo/out/episodes/05-team.mp4` | **A team that grows.** Sovereign hires a lead and a junior for a task, the mentor reviews the junior, onboarding a junior by hand, and lessons the team keeps. |
| 06 | `demo/out/episodes/06-workspace.mp4` | **The workspace.** Explorer and editor, Control K search, Ask mode, the integrated terminal, Activity and Reports. |

Making them costs nothing. The app is driven like the e2e tests, so no model is called and no credit is used.

## What is real and what is scripted

- **Real:** the built app and every screen in it, typing and clicking, files written to the project, undo, git status and diffs, and the integrated terminal (a real shell).
- **Scripted:** model replies (plans, code, reviews, answers) and provider verification. The providers shown are the ones you can connect; installing a CLI and signing in to it are prerequisites the videos do not perform.
- The project is a throwaway fixture in `/tmp/agent-hq-e2e/demo-app`, so no personal paths or names appear.

## How it is made

| Step | Tool | Output |
| --- | --- | --- |
| 1. Narrate | [edge-tts](https://github.com/rany2/edge-tts), Microsoft Edge's free neural voices; one clip per sentence, cached | `demo/public/voice/` and `timing.json` |
| 2. Record | Playwright drives the built app. Each tutorial is a spec in `tests/demo/` (`01-setup.spec.ts` …); `recorder.ts` paces every action to its sentence, glides the pointer and records a true 2× screencast (2880×1620). Chromium sends screencast frames at CSS-pixel size, so `playwright.demo.config.ts` starts it with `--force-device-scale-factor=2`, and the recorder fails if frames ever arrive smaller. `overview-stills.spec.ts` takes the overview's stills. | `demo/public/episodes/<id>/recording.mp4` and `capture.json`, `demo/public/shots/` |
| 3. Edit | [Remotion](https://www.remotion.dev) (React). Tutorials (`demo/src/series/`) get a title card, a step bar, a guided camera, the pointer with click ripples, captions and a recap card. The overview lives in `demo/src/scenes/`. Everything renders at 4K (`--scale=2`), so the recording is never enlarged. | `demo/out/*.render.mp4` |
| 4. Finish | ffmpeg normalises loudness to −16 LUFS, encodes the 4K master and supersamples it to 1080p with lanczos | `demo/out/00-overview.mp4` and `.4k.mp4`, `demo/out/episodes/<id>.mp4` and `.4k.mp4` |

Because recordings are paced by the narration, changing a sentence changes the timing of its actions on the next run.

## Commands

```bash
npm run demo                  # everything
npm run demo -- overview      # only the overview
npm run demo -- 03-auto       # only one tutorial (ids: 01-setup … 06-workspace)
DEMO_CONCURRENCY=4 npm run demo   # more render workers (each uses about 1.5 GB of RAM)
cd demo && npm run studio     # preview and scrub in Remotion Studio (record first on a fresh checkout)
```

## Requirements

- `ffmpeg`: `sudo apt install ffmpeg` (Fedora: `sudo dnf install ffmpeg`)
- `edge-tts`: `uv tool install edge-tts` (or `pipx install edge-tts`). It needs an internet connection; only the narration text is sent.
- The demo's own packages install on the first run (`demo/node_modules`, separate from the app).

## Changing it

- **A tutorial's words and steps:** `demo/src/series/episodes.json`. Each episode has its intro lines, `steps` (the step bar), `cues` (one narrated sentence each, tied to a step) and a `recap`. The spec with the same id performs the actions after `rec.say('<cue id>')`.
- **What a tutorial does:** its spec in `tests/demo/`. Model replies come from the plans in `tests/demo/scenario.ts`.
- **The overview's words:** `lines` in `demo/src/scenes.json`. Its stills come from `tests/demo/overview-stills.spec.ts`.
- **Voice:** `DEMO_VOICE=en-US-AvaNeural npm run demo`. List voices with `edge-tts --list-voices` (Arabic, for example: `ar-EG-SalmaNeural`, `ar-SA-HamedNeural`).
- A reusable prompt for making videos like these with an AI agent is in [demo-video-master-prompt.md](demo-video-master-prompt.md).

Remotion is free for individuals and companies of up to three people; larger companies need a [company license](https://www.remotion.dev/license).
