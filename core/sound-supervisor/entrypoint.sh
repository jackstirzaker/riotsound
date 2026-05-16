#!/usr/bin/env bash
set -e

# Runtime dir is backed by the iotsound-dbus named volume — shared with consumers.
mkdir -p /run/iotsound-dbus

# Clear stale state from previous runs so dbus-daemon can bind the socket cleanly.
rm -f /run/iotsound-dbus/socket /run/iotsound-dbus/avahi-ready

echo "[entrypoint] Starting dbus-daemon..."
dbus-daemon --config-file=/etc/dbus-1/iotsound-system.conf --fork

timeout 5 bash -c 'until [ -S /run/iotsound-dbus/socket ]; do sleep 0.1; done'
echo "[entrypoint] dbus-daemon socket ready"

echo "[entrypoint] Starting avahi-daemon..."
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/iotsound-dbus/socket
avahi-daemon --no-drop-root --daemonize

# avahi-daemon --check reads /run/avahi-daemon/pid (local to this container) — valid here.
timeout 10 bash -c 'until avahi-daemon --check 2>/dev/null; do sleep 0.2; done'
echo "[entrypoint] avahi-daemon ready"

# Sentinel file: other containers wait for this instead of calling avahi-daemon --check
# (which would look for a PID file in their own container, never finding it).
touch /run/iotsound-dbus/avahi-ready

exec node build/index.js
