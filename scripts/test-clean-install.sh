#!/usr/bin/env bash
# Installs a built Linux package in a clean container, starts the app on a virtual display and checks that its
# local server answers and serves the UI. Reports the time each step took.
#
#   scripts/test-clean-install.sh debian:13 /path/Agent-HQ-x.y.z-linux-amd64.deb
#   scripts/test-clean-install.sh ubuntu:24.04 /path/Agent-HQ-x.y.z-linux-amd64.deb
#   scripts/test-clean-install.sh fedora:42 /path/Agent-HQ-x.y.z-linux-x86_64.rpm
set -euo pipefail

image="${1:?image, for example debian:13}"
package="$(realpath "${2:?path to the .deb or .rpm}")"
file="$(basename "$package")"

docker run --rm -v "$package:/pkg/$file:ro" "$image" bash -c '
  set -euo pipefail
  file="'"$file"'"
  now() { date +%s; }
  start=$(now)
  case "$file" in
    *.deb)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq >/dev/null
      apt-get install -y -qq xvfb curl >/dev/null
      apt-get install -y -qq "/pkg/$file" >/dev/null ;;
    *.rpm)
      dnf install -y -q xorg-x11-server-Xvfb curl "/pkg/$file" >/dev/null ;;
  esac
  installed=$(now)
  echo "install: $((installed - start))s"
  bin=$(command -v agent-hq || true)
  if [ -z "$bin" ]; then echo "FAIL: no agent-hq command on PATH after install"; exit 1; fi
  missing=$(ldd "$(readlink -f "$bin")" 2>/dev/null | grep "not found" || true)
  if [ -n "$missing" ]; then echo "FAIL: missing libraries"; echo "$missing"; exit 1; fi
  export HOME=/tmp/home XDG_CONFIG_HOME=/tmp/home/.config
  mkdir -p "$HOME"
  xvfb-run -a "$bin" --no-sandbox --disable-gpu >/tmp/app.log 2>&1 &
  for i in $(seq 1 90); do
    if curl -fs http://127.0.0.1:47821/api/health >/dev/null 2>&1; then
      echo "server up: $(( $(now) - installed ))s after launch"
      curl -fs http://127.0.0.1:47821/ | grep -q "<div id=\"root\"" && echo "UI served: yes" || { echo "FAIL: UI not served"; exit 1; }
      echo "PASS"
      exit 0
    fi
    sleep 1
  done
  echo "FAIL: server did not answer within 90s"; tail -20 /tmp/app.log; exit 1
'
