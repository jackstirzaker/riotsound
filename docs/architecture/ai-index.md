# AI Architecture Index

This folder is the fast path for AI-assisted debugging and feature work. Prefer these docs before scanning the whole repository.

## Read order

1. [`system-map.md`](system-map.md) — containers, ports, networks, volumes, and service responsibilities.
2. [`runtime-states.md`](runtime-states.md) — role/state transitions and the exact audio paths for standalone, master, client, and fallback.
3. [`audio-flow.md`](audio-flow.md) — detailed signal path and latency/buffer ownership.
4. [`ownership-map.md`](ownership-map.md) — where to edit for each concern.
5. [`mdns.md`](mdns.md) — mDNS/Snapcast discovery design and IPv4-only constraints.
6. [`ai-prompt.md`](ai-prompt.md) — copy/paste prompt for efficient AI debugging or feature design.

## High-value invariants

- `audio` owns PipeWire, WirePlumber, the PulseAudio-compatible server on TCP `4317`, and the virtual sinks.
- `sound-supervisor` owns orchestration, role changes, service start/stop calls, web/API endpoints, mDNS advertisement/discovery state, and Snapcast volume propagation.
- Plugins are source producers. They should send audio to `balena-sound.input` and should not pick hardware devices directly.
- `balena-sound.input` is the source mix point. `balena-sound.output` is the final playback mix point.
- In `SOUND_MULTIROOM_ROLE=disabled`, audio goes directly from `balena-sound.input` to `balena-sound.output`.
- In multiroom master playback, the local speaker normally plays through the local `snapclient`: input -> `snapcast` sink -> `snapserver` -> local `snapclient` -> output.
- Remote speakers always play through `snapclient` into `balena-sound.output`.
- `auto` is a configured role, not a single runtime state. An `auto` device can be idle, elected master, remote client, or in direct fallback.
- `SOUND_MULTIROOM_LATENCY` is a snapclient compensation value. Do not treat it as the snapserver stream buffer.
- mDNS discovery must resolve usable IPv4 LAN addresses only. Loopback, link-local, Docker bridge, veth, and IPv6 targets are intentionally rejected.
- `join` devices stop source plugins and should not become visible as Spotify/AirPlay/Bluetooth targets.
- `disabled` devices keep source plugins active and do not participate in Snapcast.

## Minimal debugging context

When asking an AI for help, include:

- The user's symptom and the role of each device: `auto`, `host`, `join`, or `disabled`.
- Whether the failing device is supposed to be source/master, local speaker, or remote client.
- Relevant logs from `sound-supervisor`, `audio`, `multiroom-server`, `multiroom-client`, and the source plugin.
- Current values of `SOUND_MULTIROOM_ROLE`, `SOUND_GROUP_NAME`, `SOUND_MULTIROOM_MASTER`, `SOUND_MULTIROOM_BUFFER_MS`, `SOUND_MULTIROOM_CAPTURE_MS`, `SOUND_MULTIROOM_LATENCY`, and `SOUND_MULTIROOM_PA_LATENCY_MS`.
- Whether `balena-sound.input`, `snapcast`, and `balena-sound.output` exist in `pactl list short sinks`.
- Whether `snapcast.monitor` exists in `pactl list short sources`.
- Whether `/multiroom`, `/multiroom/active`, `/multiroom/client-ready`, and `/multiroom/master` return expected values from `sound-supervisor`.
