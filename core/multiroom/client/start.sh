#!/usr/bin/env bash
set -e

SOUND_SUPERVISOR_PORT=${SOUND_SUPERVISOR_PORT:-80}
SOUND_SUPERVISOR="localhost:$SOUND_SUPERVISOR_PORT"
# host networking: audio and sound-supervisor share the host network stack
export PULSE_SERVER="tcp:localhost:4317"
# Wait for sound supervisor to start
while ! curl --silent --output /dev/null "$SOUND_SUPERVISOR/ping"; do sleep 5; echo "Waiting for sound supervisor to start at $SOUND_SUPERVISOR"; done

# Get mode from sound supervisor (determines whether to start snapclient at all).
MODE=$(curl --silent "$SOUND_SUPERVISOR/mode" || true)

# Wait until PulseAudio is actually ready to serve connections.
# pactl info speaks the PA protocol — it only succeeds once pipewire-pulse
# is fully initialised, unlike /dev/tcp which passes on stale sockets.
# Poll at 5s intervals so we don't hammer PA during audio container startup.
# Log only on first wait and every 30s after to keep logs readable.
_pa_waited=0
_pa_log_interval=30
until PULSE_SERVER="tcp:localhost:4317" pactl info >/dev/null 2>&1; do
  if [ $_pa_waited -eq 0 ] || [ $(( _pa_waited % _pa_log_interval )) -eq 0 ]; then
    echo "[snapclient] Waiting for PulseAudio at tcp:localhost:4317... (${_pa_waited}s)"
  fi
  sleep 5
  _pa_waited=$(( _pa_waited + 5 ))
done
echo "[snapclient] PulseAudio ready (waited ${_pa_waited}s)"

# AUTO role: container is pre-warmed at boot. Start snapclient once this device
# has a real target: either local master promotion, or a discovered/default-room
# master advertised by another device.
# JOIN/HOST: use the same readiness check so JOIN waits for discovery instead
# of falling back to its own IP.
ROLE=$(curl -sf "$SOUND_SUPERVISOR/multiroom" 2>/dev/null | grep -o '"role":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
if [[ "$ROLE" == "auto" || "$ROLE" == "join" || "$ROLE" == "host" ]]; then
  echo "[snapclient] $ROLE role — waiting for snapcast target..."
  _waited=0
  until curl -sf "$SOUND_SUPERVISOR/multiroom/client-ready" 2>/dev/null | grep -q '"active":true'; do
    if [[ "$LOG_LEVEL" == "debug" ]] && (( _waited % 300 == 0 )); then
      echo "[snapclient] Still waiting for snapcast target... (${_waited}s)"
    fi
    sleep 1
    _waited=$((_waited + 1))
  done
  echo "[snapclient] Snapcast target ready (waited ${_waited}s)"
fi

# Fetch master IP after election completes (supervisor election runs in parallel with audio init).
SNAPSERVER=$(curl --silent "$SOUND_SUPERVISOR/multiroom/master" || true)
if [[ -z "$SNAPSERVER" ]]; then
  echo "[snapclient] ERROR: no snapcast target available"
  exit 1
fi

# Snapcast hostID is identity, not display name. It must be unique per device;
# using SOUND_DEVICE_NAME here breaks fleets where the name is set globally.
if [[ -n "$BALENA_DEVICE_UUID" ]]; then
  SNAPCAST_CLIENT_ID="$BALENA_DEVICE_UUID"
else
  SNAPCAST_CLIENT_ID="$(hostname | sed -e 's/[^A-Za-z0-9.-]/-/g')"
fi

if [[ "$MODE" != "MULTI_ROOM" && "$MODE" != "MULTI_ROOM_CLIENT" ]]; then
  echo "Multi-room client disabled. Exiting..."
  exit 0
fi

SNAPCLIENT_PID_FILE=/tmp/snapclient.pid

_spawn_snapclient() {
  local target="$1"
  local latency_ms
  latency_ms="${SOUND_MULTIROOM_LATENCY:-}"
  if [[ -z "$latency_ms" ]]; then
    latency_ms=$(curl -sf "$SOUND_SUPERVISOR/multiroom/latency" 2>/dev/null | grep -o '"latencyMs":-*[0-9]*' | cut -d':' -f2 || true)
  fi
  latency_ms=${latency_ms:-400}
  local pa_latency_ms="${SOUND_MULTIROOM_PA_LATENCY_MS:-100}"
  local latency="--latency ${latency_ms}"
  echo "[snapclient] Starting → $target ($latency, pulse buffer ${pa_latency_ms}ms, hostID $SNAPCAST_CLIENT_ID)"
  PULSE_SERVER="tcp:localhost:4317" \
  PULSE_LATENCY_MSEC="$pa_latency_ms" \
  /usr/bin/snapclient \
    --player "pulse:server=tcp:localhost:4317,buffer_time=${pa_latency_ms}" \
    --host "$target" \
    $latency \
    --hostID "$SNAPCAST_CLIENT_ID" \
    --logfilter '*:error' \
    >/dev/null &
  echo $! > "$SNAPCLIENT_PID_FILE"
}

echo "Starting multi-room client..."
echo "- balenaSound mode: $MODE"
echo "- Target snapcast server: $SNAPSERVER"

_spawn_snapclient "$SNAPSERVER"

# Watchdog: re-fetch master IP every 5s. If it changes while snapclient is
# running (e.g. this device just promoted to master), kill and respawn with
# the new target without restarting the container.
while true; do
  sleep 5
  SNAPCLIENT_PID=$(cat "$SNAPCLIENT_PID_FILE" 2>/dev/null || true)
  if [[ -z "$SNAPCLIENT_PID" ]] || ! kill -0 "$SNAPCLIENT_PID" 2>/dev/null; then
    wait "$SNAPCLIENT_PID" 2>/dev/null || true
    RC=$?
    echo "[snapclient] exited with code $RC"
    exit $RC
  fi
  NEW_SERVER=$(curl --silent "$SOUND_SUPERVISOR/multiroom/master" 2>/dev/null || true)
  if [[ -n "$NEW_SERVER" && "$NEW_SERVER" != "$SNAPSERVER" ]]; then
    echo "[snapclient] Master changed: $SNAPSERVER → $NEW_SERVER. Respawning."
    kill "$SNAPCLIENT_PID" 2>/dev/null || true
    wait "$SNAPCLIENT_PID" 2>/dev/null || true
    SNAPSERVER="$NEW_SERVER"
    _spawn_snapclient "$SNAPSERVER"
  fi
done
