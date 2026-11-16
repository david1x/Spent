#!/bin/bash
set -eu

: "${SCREEN_PASSWORD:?Set SPENT_SCREEN_PASSWORD in .env (6 to 8 characters, VNC only uses the first 8)}"
SIZE="${SCREEN_SIZE:-1366x900}"

# Kept in a file, not on the command line, so it doesn't show in the process list.
mkdir -p "$HOME/.vnc"
x11vnc -storepasswd "$SCREEN_PASSWORD" "$HOME/.vnc/passwd" >/dev/null 2>&1

# Listens on TCP 6000 so Spent's container can draw on it. -ac lets it in
# without an X cookie; only containers on this compose network can reach the
# port. MIT-SHM is off because shared memory doesn't cross containers.
Xvfb :0 -screen 0 "${SIZE}x24" -listen tcp -nolisten unix -ac -extension MIT-SHM &

for _ in $(seq 1 50); do
  [ -e /tmp/.X0-lock ] && break
  sleep 0.1
done

# VNC stays inside the container; only noVNC (6080) is published.
x11vnc -display :0 -rfbauth "$HOME/.vnc/passwd" -localhost -forever -shared -quiet -noxdamage -noshm &

websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "[screen] ready: open http://<host>:6080/vnc.html?autoconnect=1&resize=scale"

# Stop the container (and let restart: bring it back) if any part dies.
wait -n
exit 1
