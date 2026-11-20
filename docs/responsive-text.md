# Responsive text

Agent HQ keeps single-line UI text on one line at every window width, down to the 1024 × 640 minimum. When there isn't room, text ends in an ellipsis and its full value appears in a tooltip.

## Conventions

- **Single-line text**: add `truncate`, or use `<Truncate>` from `src/components/ui/primitives.tsx`. Its parent flex or grid item needs `min-w-0` so it is allowed to shrink. Icons and essential buttons get `shrink-0` so the text gives way first.
- **Shared primitives already handle this**: `Button`, `Badge`, `Tabs`, `PageTitle`, `Section`, `Field`, `Select` and `Dialog` titles truncate their own labels.
- **Minimum label width**: `ahq-min-label` keeps at least about five characters visible, or the whole label if it is shorter. Use it where a label would otherwise collapse to one letter.
- **Tables**: give the descriptive column `w-full max-w-0` and put a `truncate` element inside it. Hide low-priority columns with container queries (`@container` on the wrapper, then `hidden @4xl:table-cell`), not with a fixed `min-width`.
- **Multiline content**: descriptions, paragraphs, logs, chat, editors and inputs wrap on purpose. Mark custom multiline blocks with `data-multiline` so the layout audit skips them.

## Overflow tooltip

`OverflowTooltipHost`, mounted once in `App.tsx` and once in `tray.tsx`, watches hover and keyboard focus for the whole document. It measures the rendered text, with no character limits, and shows a tooltip only when that text is actually cut off. The tooltip is portalled to `<body>`, so containers never clip it. Because the full text is already in the DOM, assistive technology reads it without the tooltip.

- Add `data-no-overflow-tooltip` to opt an element out.
- An element with its own `title` keeps its native tooltip. Only use `title` when it adds information the text does not, such as a full file path.
- Set `data-full-text` (or `fullText` on `<Truncate>`) when the visible text is an abbreviation.

## Tests

`tests/e2e/responsive.spec.ts` audits every screen with `tests/e2e/layoutAudit.ts` at 1024, 1280 and 1920 px, with normal and widened text. It also covers the tooltip and live resizing. `tests/unit/overflow.test.ts` covers tooltip placement and workspace pane fitting.
