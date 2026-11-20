# UI motion

Agent HQ keeps its colors, typography, density and component APIs. Motion communicates selection, feedback and the relationship between an overlay and its content.

## Reference comparison

Reviewed Magpie's public source (`yetone/magpie`, commit `22cddd5`) on November 20, 2026. Relevant files are `internal/gui/assets/app.css` and `app.js`. No binary analysis or copied assets are needed.

| Interaction | Magpie source | Agent HQ implementation |
| --- | --- | --- |
| Selection | Shared sliding thumb, remeasured on resize | Shared `useSelectionIndicator` for tabs and primary navigation; transforms animate selection, geometry refits immediately on resize |
| Feedback | Short color transitions and restrained press scaling; navigation rows stay still | Shared button, icon button and field feedback; navigation never scales |
| Dialog | Independent scrim and surface; faster exit; preserved focus | Separate scrim fade and surface settle, retained exit, focus trap and background inertness until exit completes |
| Select | Anchored opening, direction-aware movement, retained exit | Portaled listbox with top/bottom transform origin, reversible CSS transitions and inert closing content |
| Sidebar | Labels stay proportionate during width changes | Existing width transition uses shared timing; labels fade early and return after a short delay |
| Reduced motion | Gentler movement and system preference | Positional motion and press scaling disabled; existing global reduced-motion convention retained |

These are independently implemented interaction patterns. Magpie's source uses an MIT license.

## Shared rules

Tokens live in `src/styles/globals.css`: feedback 140 ms, selection 240 ms, entrance 280 ms and exit 160 ms. Surfaces animate opacity and transform. The sidebar keeps its existing width animation because the adjacent workspace must resize with it; this incurs layout work and should be checked on slower hardware.

`usePresence` retains a closing surface for the exit duration and cancels removal if reopened. Keep its delay synchronized with `--motion-exit`. Reduced motion removes closed surfaces immediately. `@starting-style` supplies initial styles without JavaScript animation loops. Electron's bundled Chromium supports it.

`Presence` retains the selected agent or task while its details panel closes. The panel's owner must remain mounted during this interval; conditionally removing the owner would bypass the exit. Dialogs retain their last open content during closing so state cleanup cannot blank their title or swap their actions mid-transition. Focus and background inertness are restored synchronously when the dialog leaves.

`useSelectionIndicator` measures actual rendered geometry. ResizeObserver refits without tweening so the indicator follows resized labels and containers. It disconnects observers and cancels animation frames on unmount.

Editor input, terminal output, live metrics and command palette shortcuts stay immediate. Existing multiline descriptions and truncation behavior remain unchanged. Do not replay entrances when dialog contents update.
