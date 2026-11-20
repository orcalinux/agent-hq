# Tray quick status

Click the Agent HQ icon in your desktop's tray, or use **View → Quick status**.
Some Linux tray hosts display the native menu first; its **Quick status** item
opens the same panel.

The panel has three tabs:

- **Overview** shows the current project, run and task progress, changes awaiting
  review, connected providers and recorded usage. Costs retain the app's
  “unpriced” or partial-price indication. Demo missions are explicitly labelled.
- **Agents** shows each agent's status and effective model, including role
  defaults. Clicking an agent opens its configuration in the main window.
- **Activity** shows the eight most recent events, including warnings and errors.

Escape, the close button or moving focus to another window dismisses it. Closing
the main window leaves the app running; use **Quit** to exit.

## Reference and implementation

Magpie's compact tray panel was inspected before implementation using its
[published panel screenshot](https://usemagpie.ai/img/panel-dark.png),
[GUI shell notes](https://github.com/yetone/magpie/blob/main/docs/subsystems/gui-shell.md),
and the locally extracted `panelfirst.js`, `panelarrange.js` and `traywindows.js`
assets. REA's static analysis of those selected assets is retained as evidence
`ev_8e8ac42ae6029231a22fe99d6affa0e1eeac1df78e17b1dab414ad1d66c535fe`.
This establishes the design reference, not an observation of a live Magpie click.

Agent HQ implements its own panel using its existing React components and theme
tokens. It does not copy Magpie's assets or change Magpie's configuration.
Subscription quota cards are not reproduced: Agent HQ displays the measured
usage it actually records.

The main renderer remains the source of truth and publishes a limited snapshot
through its existing desktop bridge. The tray renderer has a separate entry
point and a separate sandboxed preload with only `getState`, `onState` and
`action`. It does not start another agent runner or receive prompts or provider
credentials. Navigation actions return to the main window.

The popup is placed relative to the icon where bounds are available, otherwise
the pointer, and clamped to that display's work area. Native Wayland compositors
may control positioning and activation; Linux tray hosts differ in which gesture
activates a tray item.

## Verification

`npm test` covers placement, snapshot aggregation, model labels, simulation labels,
and the exclusion of private agent instructions. `npm run test:desktop` checks
live updates, navigation, reuse and dismissal, idle/background lifecycle, theme
changes, long text and preload isolation, and captures screenshots of every tab.
The screenshots use test data; normal launches use the current project. On Linux
with `gdbus` and a StatusNotifier tray host, a further desktop test activates the
app's own registered native tray item, verifies that it opens and toggles the
panel, and exits through its Quit button. This check skips on hosts without that
native tray service.
