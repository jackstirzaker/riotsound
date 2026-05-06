#!/bin/sh
set -eu

INTERVAL="${HOSTNAME_SYNC_INTERVAL:-60}"

apply_hostname() {
  # SOUND_DEVICE_NAME is injected automatically by balena from fleet/device variables.
  TARGET_HOSTNAME="${SOUND_DEVICE_NAME:-iotsound}"

  # `hostname` returns the container's own short ID, not the host OS hostname.
  # Read the applied value from the supervisor host-config API instead.
  CURRENT_HOSTNAME=$(curl -sf \
    "$BALENA_SUPERVISOR_ADDRESS/v1/device/host-config?apikey=$BALENA_SUPERVISOR_API_KEY" \
    | grep -o '"hostname":"[^"]*"' | cut -d'"' -f4 || true)

  if [ -z "$CURRENT_HOSTNAME" ]; then
    echo "[hostname] Could not read current hostname from supervisor — skipping"
    return 0
  fi

  echo "[hostname] Current hostname: $CURRENT_HOSTNAME"
  echo "[hostname] Target hostname: $TARGET_HOSTNAME"

  if [ "$CURRENT_HOSTNAME" = "$TARGET_HOSTNAME" ]; then
    echo "[hostname] Already set. Skipping."
    return 0
  fi

  echo "[hostname] Setting hostname to: $TARGET_HOSTNAME"

  curl -fsS -X PATCH \
    --header "Content-Type: application/json" \
    --data "{\"network\": {\"hostname\": \"$TARGET_HOSTNAME\"}}" \
    "$BALENA_SUPERVISOR_ADDRESS/v1/device/host-config?apikey=$BALENA_SUPERVISOR_API_KEY"

  echo "[hostname] Done"
}

while true; do
  apply_hostname || echo "[hostname] Update failed; will retry"
  sleep "$INTERVAL"
done
