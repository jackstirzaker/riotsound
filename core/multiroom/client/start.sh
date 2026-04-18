#!/usr/bin/env bash
set -e

SOUND_SUPERVISOR_PORT=${SOUND_SUPERVISOR_PORT:-80}
SOUND_SUPERVISOR="$(ip route | awk '/default / { print $3 }'):$SOUND_SUPERVISOR_PORT"
# Wait for sound supervisor to start
while ! curl --silent --output /dev/null "$SOUND_SUPERVISOR/ping"; do sleep 5; echo "Waiting for sound supervisor to start at $SOUND_SUPERVISOR"; done

# Get mode and snapserver from sound supervisor
# mode: default to MULTI_ROOM
# snapserver: default to multiroom-server (local)
MODE=$(curl --silent "$SOUND_SUPERVISOR/mode" || true)
SNAPSERVER=$(curl --silent "$SOUND_SUPERVISOR/multiroom/master" || true)
SUPERVISOR_DEVICE_IP=$(curl --silent "$SOUND_SUPERVISOR/device/ip" || true)
if [[ -z "$SNAPSERVER" || "$SNAPSERVER" == "null" ]]; then
  SNAPSERVER=${SOUND_MULTIROOM_MASTER:-multiroom-server}
fi

# If the supervisor reports itself as the multiroom master, use the internal service name
# so the local client connects over the Docker network instead of via host IP mapping.
if [[ -n "$SUPERVISOR_DEVICE_IP" && "$SNAPSERVER" == "$SUPERVISOR_DEVICE_IP" ]]; then
  echo "Detected local master IP $SNAPSERVER; switching snapserver host to multiroom-server"
  SNAPSERVER=multiroom-server
fi

# --- ENV VARS ---
# SOUND_MULTIROOM_LATENCY: latency in milliseconds to compensate for speaker hardware sync issues
LATENCY=${SOUND_MULTIROOM_LATENCY:+--latency "$SOUND_MULTIROOM_LATENCY"}

SNAPSERVER_PORT=${SOUND_SNAPCAST_PORT:-1704}
SNAPSERVER_HOST=${SNAPSERVER%%:*}

wait_for_snapserver() {
  local host="$1"
  local port="$2"
  while ! bash -c "cat < /dev/tcp/$host/$port > /dev/null 2>&1"; do
    echo "Waiting for snapserver at $host:$port"
    sleep 2
  done
}

echo "Starting multi-room client..."
echo "- balenaSound mode: $MODE"
echo "- Target snapcast server: $SNAPSERVER"

# Set the snapcast device name for https://github.com/iotsound/iotsound/issues/332
if [[ -z $SOUND_DEVICE_NAME ]]; then
    SNAPCAST_CLIENT_ID=$BALENA_DEVICE_UUID
else
    # The sed command replaces invalid host name characters with dash
    SNAPCAST_CLIENT_ID=$(echo $SOUND_DEVICE_NAME | sed -e 's/[^A-Za-z0-9.-]/-/g')
fi

# Start snapclient
if [[ "$MODE" == "MULTI_ROOM" || "$MODE" == "MULTI_ROOM_CLIENT" ]]; then
  wait_for_snapserver "$SNAPSERVER_HOST" "$SNAPSERVER_PORT"
  /usr/bin/snapclient --host $SNAPSERVER $LATENCY --hostID $SNAPCAST_CLIENT_ID --logfilter *:error
else
  echo "Multi-room client disabled. Exiting..."
  exit 0
fi
