# Testing

## v5.0 Validation Matrix

This document records what was manually validated for the v5.0 release and calls out known gaps where community help is needed.

### Hardware tested

| Device | Role | Notes |
|---|---|---|
| Raspberry Pi 4 (raspberrypi4-64) | Master + client (AUTO) | Primary test device — wispy-road |
| Raspberry Pi 3 B/B+ (raspberrypi3-64) | Remote client (AUTO) | Coolbeans — 2.4 GHz WiFi |

### Audio outputs tested

| Output | Device | Result |
|---|---|---|
| DAC HAT (I2S) | Raspberry Pi 4 | ✔ Confirmed working |
| 3.5mm headphone jack | Raspberry Pi 3 B/B+ | ✔ Confirmed working |
| HDMI | — | ✘ Not tested in this release |
| USB sound card / USB DAC | — | ✘ Not tested in this release |

### Audio sources tested

| Source | Result | Notes |
|---|---|---|
| Spotify Connect (librespot) | ✔ Confirmed working | Both devices visible and selectable |
| AirPlay | — | Service present, not validated in this sprint |
| Bluetooth | — | Service present, not validated in this sprint |

### Multi-room scenarios tested

| Scenario | Result | Notes |
|---|---|---|
| Pi 4 master + Pi 3 B/B+ client | ✔ Confirmed working | mDNS discovery, dynamic election, audio sync |
| Volume sync across devices | ✔ Confirmed working | |
| 30s demotion after stream stops | ✔ Confirmed working | |
| Role-aware latency (150ms master / 400ms client) | ✔ Confirmed working | |
| 2+ clients simultaneously | ✘ Not tested | Only 1 client available during validation |
| Pi 3 B/B+ as master | ✘ Not tested | Known BT/WiFi interference risk; Pi 4 preferred for master |
| Multiple groups on the same network | ✘ Not tested | |
| Cross-VLAN with `SOUND_MULTIROOM_MASTER` override | ✘ Not tested | Code path exists, not validated |

### Network conditions tested

| Condition | Result | Notes |
|---|---|---|
| 2.4 GHz + WiFi 6 on same subnet | ✔ Confirmed working | mDNS inter-band confirmed after WPA2 config |
| Ethernet | ✘ Not tested | |
| WPA3 / PMF disabled for Pi 3 | ✔ Recommended workaround confirmed needed | See [support docs](./07-support.md#avoid-wpa3--pmf-on-24-ghz) |

### Karaoke plugin

Karaoke is included in v5.0 but hardware validation is incomplete — see open items in `KARAOKE_WORKING_PROMPT.md`. Treat it as **beta** for this release.

---

## Help wanted

We only have two devices available for testing. If you can validate IoTSound on any of the untested hardware or scenarios above, please comment on [this issue](https://github.com/JaragonCR/iotsound/issues) with your findings.

We are specifically looking for validation on:

- Raspberry Pi 5
- Raspberry Pi 1 / Zero / Zero W (client role)
- Raspberry Pi 2
- Intel NUC
- USB sound cards and USB DACs
- HDMI audio output on Pi 4 and Pi 5
- AirPlay and Bluetooth source validation in v5.0
- Multi-client multi-room (3+ devices)
- Ethernet-only setups
- Multiple groups on the same network

If you are willing to send hardware for validation, please reach out via a GitHub issue — we will test, document, and return it.
