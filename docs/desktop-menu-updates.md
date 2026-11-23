# Desktop menus and manual updates

Introduced in **0.16.0**.

## Check whenever you want

Click the refresh icon in the title bar, or open the application menu and choose
**Check for updates** at the bottom. The native **Help → Check for Updates**
command opens the same window. **Settings → Updates → Check now** works too.

A manual check runs immediately, even if automatic checks are off or the next
scheduled check is hours away. It does not change your automatic-update
preferences. Checks already in progress are shared; a download or an update
already ready to install is shown without starting another download.

The update window shows the installed version, the check result and timestamp,
download size and progress when available, and a retry action if the request
fails. An available update can be downloaded there. A downloaded update offers
**Review and restart**, using the existing release-note and busy-agent safeguards.
Closing the window leaves a download running.

Development builds explain that installation is unavailable and link to Releases.
They do not claim to have checked for a published version.

## The application menu

On Linux and Windows the title-bar menu is drawn with the app's surface, border,
type and motion tokens. File, Edit, View, Window and Help come from the native
Electron application menu, rather than a separate list that can drift out of sync.
Submenus replace the panel's contents, keeping actions within narrow windows.
Long sections scroll; the manual update action stays at the bottom.

- Up/Down moves between actions; Home/End moves to the first/last action.
- Enter or Space activates an action. Right opens a submenu; Left goes back.
- Typing a letter selects a matching action.
- Escape closes the panel and returns focus to its trigger.
- Clicking elsewhere dismisses it without stealing focus from the clicked item.

Native Edit actions restore the previous editing focus before execution.
Menu IPC accepts only visible, enabled entries in the application menu and only
from the trusted main renderer. Arbitrary command strings are not executed.
The native menu and its OS shortcuts remain available. macOS keeps its native
application menu bar; the title-bar update check is available on all platforms.

## Design references and scope

The source review used Magpie (`yetone/magpie`, revision `d7126a2`), especially
`internal/gui/assets/app.css`, `app.js` and its update interval/status controls.
The useful patterns were a separate manual check, persistent status feedback,
compact menu density, constrained overflow and short opacity/transform motion.
Agent HQ uses its existing components and motion tokens; no Magpie source or
new UI dependency was imported. Electron's menu roles and the VS Code manual
update command were also reviewed as platform references.

## Verification

Desktop regression coverage exercises manual checks with scheduling and update
badges disabled, available/downloading/ready/up-to-date/error/unsupported states,
retry, both native and themed menu entry points, settings navigation, and the
release-note handoff without leaving the app inert. Menu coverage includes
640×360, 1000×700 and 1440×900 windows in light and dark, keyboard navigation,
native zoom and clipboard actions, and invalid menu identifiers.

Update delivery is driven by published GitHub Releases and their updater
metadata. The desktop tests use the existing update simulation to exercise
transitions without replacing or restarting the test installation. A complete
installer-to-installer upgrade on each operating system remains a separate
release verification step.

To check the actual published update feed, build a Linux AppImage with
`npx electron-builder --linux AppImage --publish never`, then run
`npm run test:updates:packaged` on a graphical desktop. The script launches the
packaged executable with an isolated temporary profile, disables automatic
downloads and restarts, requests a real manual update check and checks the
result. Use Xvfb in headless environments. `AGENT_HQ_PACKAGED_EXECUTABLE` selects
another packaged executable. The script prints its state and screenshot path.

Verified on Linux on 2026-11-23: 218 unit tests, 46 production browser tests
(four opt-in tests skipped), 21 desktop tests (OS tiling opt-in skipped), and a
successful real GitHub update check from the packaged 0.16.0 AppImage build.
The desktop tests include reduced-motion and outside-click dismissal checks.
Windows and macOS runtime behavior was not exercised locally.

The first 0.16.0 release attempt exposed two Unix file-mode assertions on the
Windows runner. In 0.16.1 only those assertions are platform-specific; encryption
and journal behavior are still tested on every platform. Release builds now
upload to a draft and publish it only after all three platforms, notes and
checksums succeed.
