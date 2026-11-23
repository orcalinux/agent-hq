#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for program in xvfb-run dbus-run-session xfwm4 xfconf-query xdotool xprop rg; do
  command -v "$program" >/dev/null || { echo "Missing native tiling test dependency: $program" >&2; exit 1; }
done
for resolution in 1920x1080 1280x800; do
  tiling_config=$(mktemp -d /tmp/agent-hq-tiling-config.XXXXXX)
  env XDG_CONFIG_HOME="$tiling_config" xvfb-run -a -s "-screen 0 ${resolution}x24" dbus-run-session -- bash -eu -c '
    for binding in F9:left F10:right F11:up F12:down; do
      xfconf-query -c xfce4-keyboard-shortcuts -p "/xfwm4/custom/<Primary><Alt>${binding%%:*}" -n -t string -s "tile_${binding#*:}_key"
    done
    xfwm4 --compositor=off >"$XDG_CONFIG_HOME/window-manager.log" 2>&1 &
    window_manager=$!
    trap "kill $window_manager" EXIT
    for attempt in $(seq 1 30); do
      if xprop -root _NET_SUPPORTING_WM_CHECK | rg -q "window id"; then break; fi
      sleep 0.1
    done
    AGENT_HQ_TEST_TILING=1 npx playwright test -c playwright.desktop.config.ts --grep "native desktop shortcuts"
  '
done
