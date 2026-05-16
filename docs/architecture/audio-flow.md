# Audio Flow

End-to-end signal paths for standalone and multiroom playback. Each multiroom stage lists the buffer it introduces, which file owns it, and the env var to change it (if any).

---

## Standalone path

Used when `SOUND_MULTIROOM_ROLE=disabled`.

```
[Plugin source: librespot / airplay / bluetooth / karaoke / upnp]
        │  PCM audio written to balena-sound.input
        ▼
balena-sound.input                              (PipeWire null sink, audio container)
        │  loopback rule
        ▼
balena-sound.output                             (PipeWire null sink, audio container)
        │  loopback rule
        ▼
Hardware DAC / ALSA sink
        │
        ▼
Speakers
```

No `snapserver` or `snapclient` is used in this mode.

---

## Multiroom master path

Used when a device is `host` or when an `auto` device promotes to master. The master normally plays local audio through its own local `snapclient`.

```
[Plugin source: librespot / airplay / bluetooth]
        │  PCM audio written to balena-sound.input (PipeWire null sink)
        ▼
balena-sound.input                              (PipeWire null sink, audio container)
        │  WirePlumber loopback rule
        ▼
snapcast                                        (PipeWire null sink, audio container)
        │  pacat --record --device=snapcast.monitor
        │  Buffer: 50 ms default
        │  Env var: SOUND_MULTIROOM_CAPTURE_MS
        ▼
FIFO pipe  /tmp/snapserver-audio               (kernel pipe buffer, ~64 KB)
        │
        ▼
snapserver  (multiroom-server container)
        │  Stream buffer: 400 ms default
        │  Env var: SOUND_MULTIROOM_BUFFER_MS   (set per-fleet or per-device)
        │
        ├── local loopback ─────────────────────────────────────────
        │
        ▼
snapclient  (multiroom-client container on the master device)
        │  Hardware latency offset: 400 ms default
        │  Env var: SOUND_MULTIROOM_LATENCY
        │
        │  PulseAudio sink-input buffer: 100 ms default
        │  Env var: SOUND_MULTIROOM_PA_LATENCY_MS
        ▼
balena-sound.output                            (PipeWire null sink, audio container)
        │  WirePlumber loopback rule
        ▼
Hardware DAC / ALSA sink
        │
        ▼
Speakers
```

Remote clients receive the same Snapcast stream:

```
snapserver  (master device)
        │
        ▼  ── network ──────────────────────────────────────────────
        │
snapclient  (multiroom-client container, each speaker device)
        │  Hardware latency offset: 400 ms default
        │  Env var: SOUND_MULTIROOM_LATENCY     (set per-device)
        │
        │  PulseAudio sink-input buffer: 100 ms default
        │  Env var: SOUND_MULTIROOM_PA_LATENCY_MS
        ▼
balena-sound.output                            (PipeWire null sink, audio container)
        │  WirePlumber loopback rule
        ▼
Hardware DAC / ALSA sink
        │  DAC hardware buffer — device-specific, not configurable via env var
        │  (HiFiBerry PCM5122: typically ~5 ms)
        ▼
Speakers
```

---

## Auto direct fallback

An `auto` device that promotes to master can temporarily bypass Snapcast if no snapclient connects within the fallback window.

```
[Plugin source]
        │
        ▼
balena-sound.input
        │  runtime fallback loopback loaded by sound-supervisor
        ▼
balena-sound.output
        │
        ▼
Hardware DAC / speakers
```

This fallback is not the same as `SOUND_MULTIROOM_ROLE=disabled`: the configured role is still `auto`, and routing is restored to Snapcast when the device demotes.

---

## Buffer reference table

| Stage | Default | Owner file | Env var |
|---|---|---|---|
| pacat capture | 50 ms | `core/multiroom/server/start.sh` | `SOUND_MULTIROOM_CAPTURE_MS` |
| Kernel FIFO pipe | ~64 KB | OS | — not applicable — |
| snapserver stream buffer | 400 ms | `core/multiroom/server/start.sh` | `SOUND_MULTIROOM_BUFFER_MS` |
| snapclient hardware latency offset | 400 ms | `core/multiroom/client/start.sh` | `SOUND_MULTIROOM_LATENCY` |
| PulseAudio sink-input (snapclient → PA) | 100 ms | `core/multiroom/client/start.sh` | `SOUND_MULTIROOM_PA_LATENCY_MS` |
| Hardware DAC | device-specific | n/a | — not configurable — |

---

## How latency offsets work

`SOUND_MULTIROOM_LATENCY` is passed to snapclient as `--latency N`. It is a **hardware/output-path compensation** value, not a plain "delay this speaker" knob.

Snapclient describes this flag as the latency of the PCM device. In practice, use it to tell Snapcast that a device's local output path is already slow. If a Pi, HDMI output, DAC, or audio stack adds about 500 ms after snapclient writes the sample, setting that device near `SOUND_MULTIROOM_LATENCY=500` gives Snapcast enough information to schedule that client against the rest of the group.

- All clients receive the **same audio data** from snapserver at the same wall-clock time.
- If one device is consistently late because its hardware path is slow, raise `SOUND_MULTIROOM_LATENCY` on that device first.
- If a device is consistently early, lower that device's value or raise the later device only if the later path is known to have hardware latency.
- Large values require enough Snapcast buffering. The master enforces an effective `SOUND_MULTIROOM_BUFFER_MS` of at least `SOUND_MULTIROOM_LATENCY + 100` for its own configured latency; if a remote client has an even larger per-device latency, set the master's requested buffer high enough for that client too.
- Setting mismatched values intentionally desynchronises the speakers unless they match real hardware/path differences. Use the same value on identical devices and outputs.
- The server reports each client's configured latency as 0 — it is purely client-side and does not feed back to the server.

### Sync tuning workflow

Keep tuning methodical. Change one variable at a time, restart the affected `multiroom-client`, and test with the same source and volume each time.

1. Stabilize buffers first:
   - `SOUND_MULTIROOM_BUFFER_MS`: master Snapserver stream buffer. Raise if all clients stutter together. The effective server buffer is whichever is larger: the requested value or `SOUND_MULTIROOM_LATENCY + 100` on the master.
   - `SOUND_MULTIROOM_CAPTURE_MS`: master `pacat` capture buffer into Snapserver. Raise if the master capture path underruns.
   - `SOUND_MULTIROOM_PA_LATENCY_MS`: per-client snapclient-to-PulseAudio buffer. Use this for stability, not fine sync.
2. Start with conservative buffers:
   - `SOUND_MULTIROOM_BUFFER_MS=250-400`
   - `SOUND_MULTIROOM_CAPTURE_MS=50-100`
   - `SOUND_MULTIROOM_PA_LATENCY_MS=200`
3. Tune per-device sync with `SOUND_MULTIROOM_LATENCY`:
   - A late device with a slow hardware path: increase that device's value in 50-100 ms steps.
   - An early device: decrease that device's value, or increase the genuinely late hardware path if known.
   - Avoid huge values on the faster device just to wait for a slow device; that increases delay from reality and can exceed the client's buffer.

### Working example: Pi4 master to Pi3 client

This fleet had a Pi4 with a HiFiBerry-style output and a Pi3 using the Raspberry Pi HDMI/mailbox sink. The Pi3 remained roughly 500 ms late even after normal buffer tuning. The important discovery was that the Pi3 hardware sink was:

```
alsa_output.platform-3f00b840.mailbox.stereo-fallback
```

The audio startup code treats mailbox/HDMI outputs as high-latency paths because they can have hardware periods in the hundreds of milliseconds. That means the better fix is to compensate the Pi3 hardware path, not to delay the Pi4 by a large amount.

Known-good-ish baseline from live testing:

| Device | Role in test | Important values |
|---|---|---|
| Pi4 | master/source | `SOUND_MULTIROOM_BUFFER_MS=250`, `SOUND_MULTIROOM_CAPTURE_MS=50`, `SOUND_MULTIROOM_PA_LATENCY_MS=400`, `SOUND_MULTIROOM_LATENCY=400-600` during testing |
| Pi3 | remote client | `SOUND_MULTIROOM_PA_LATENCY_MS=100-200`, `SOUND_MULTIROOM_LATENCY=0` before compensation |

Observed behavior:

- Pi4 audio could go silent when pushed above about `SOUND_MULTIROOM_LATENCY=600`, because the latency value was larger than the useful local playback buffer/headroom.
- Pi3 was still late, which pointed to Pi3's HDMI/mailbox output path rather than network jitter.

Recommended next calibration for this hardware:

```
# Pi4: keep the fast/local path modest
SOUND_MULTIROOM_LATENCY=0-200
SOUND_MULTIROOM_PA_LATENCY_MS=200

# Pi3: compensate the slow HDMI/mailbox output path
SOUND_MULTIROOM_LATENCY=500
SOUND_MULTIROOM_PA_LATENCY_MS=200
```

Then tune Pi3 in small steps:

- Pi3 still late: try `600`.
- Pi3 now early: try `400`.
- Either device stutters or goes silent: increase `SOUND_MULTIROOM_PA_LATENCY_MS` or reduce the latency offset.

These numbers are not universal. They vary by Raspberry Pi model, OS/audio stack, DAC or HDMI path, CPU load, Wi-Fi/Ethernet quality, and which device is currently master.

## Key PipeWire null sinks

| Sink | Purpose |
|---|---|
| `balena-sound.input` | Plugin capture point — all sources write here |
| `snapcast` | Multiroom capture — WirePlumber loopback feeds from balena-sound.input:monitor |
| `balena-sound.output` | Playback mixing point — all consumers read from here |

WirePlumber loopback rules live in `core/audio/` and wire these sinks together automatically.
