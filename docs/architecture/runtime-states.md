# Runtime States

`SOUND_MULTIROOM_ROLE` is configuration. Runtime state is what the device is doing right now.

## Role matrix

| Configured role | Source plugins | Runs `multiroom-server` | Runs `multiroom-client` | Can become master | Typical use |
|---|---|---:|---:|---:|---|
| `auto` | yes | pre-warmed, active after promotion | pre-warmed, active after target exists | yes, on first play | Normal devices. |
| `host` | yes | yes | yes | always | Dedicated source/master device. |
| `join` | no | no | yes | no | Passive speaker. |
| `disabled` | yes | no | no | no | Independent standalone room. |

## Runtime audio paths

### Disabled standalone

```mermaid
flowchart LR
  Source["Plugin source"] --> Input["balena-sound.input"]
  Input --> Output["balena-sound.output"]
  Output --> Hardware["Hardware DAC / speakers"]
```

Owner notes:

- Configured by `core/audio/start.sh` when role is `disabled`.
- `sound-supervisor` stops both multiroom services and starts source plugins.

### Multiroom master with local playback

```mermaid
flowchart LR
  Source["Plugin source"] --> Input["balena-sound.input"]
  Input --> SnapSink["snapcast sink"]
  SnapSink --> Pacat["pacat capture"]
  Pacat --> Server["snapserver"]
  Server --> LocalClient["local snapclient"]
  LocalClient --> Output["balena-sound.output"]
  Output --> Hardware["Hardware DAC / speakers"]
  Server --> RemoteClient["remote snapclients"]
```

Owner notes:

- The master normally hears itself through its own local `snapclient`.
- `multiroom-server` waits for `/multiroom/active` before starting `pacat`.
- `multiroom-client` waits for `/multiroom/client-ready`, fetches `/multiroom/master`, and respawns if the master IP changes.

### Remote client playback

```mermaid
flowchart LR
  RemoteServer["remote snapserver"] --> Client["local snapclient"]
  Client --> Output["balena-sound.output"]
  Output --> Hardware["Hardware DAC / speakers"]
```

Owner notes:

- `join` devices live here all the time.
- `auto` devices live here when they discover another master before promoting.
- Source plugins should be stopped for `join`, but remain active for `auto`.

### Auto master direct fallback

```mermaid
flowchart LR
  Source["Plugin source"] --> Input["balena-sound.input"]
  Input --> Output["balena-sound.output"]
  Output --> Hardware["Hardware DAC / speakers"]
```

Owner notes:

- This is a runtime fallback, not the same as `disabled`.
- Triggered by `sound-supervisor` if an `auto` master has no connected Snapcast clients after `MULTIROOM_FALLBACK_MS`.
- Implemented by unloading the input -> `snapcast` loopback and loading input -> `balena-sound.output`.
- On stop/demotion, supervisor restores input -> `snapcast`.

## Promotion and demotion sequence

```mermaid
sequenceDiagram
  participant Plugin as Source plugin
  participant Audio as audio / WirePlumber
  participant API as sound-supervisor API
  participant Config as SoundConfig
  participant Monitor as SnapserverMonitor
  participant Server as multiroom-server
  participant Client as multiroom-client

  Plugin->>Audio: send audio to balena-sound.input
  Audio->>API: POST /internal/play
  API->>Config: applyElectionResult(master)
  API->>Monitor: setMaster(true)
  Config->>Server: start service
  Config->>Client: start service
  Server->>API: poll /multiroom/active
  Client->>API: poll /multiroom/client-ready
  API-->>Server: active=true
  API-->>Client: active=true
  Client->>API: GET /multiroom/master
  Client->>Server: connect snapclient to snapserver
  Monitor->>Monitor: advertise _snapcast._tcp
```

## Stop sequence

```mermaid
sequenceDiagram
  participant Audio as audio / WirePlumber
  participant API as sound-supervisor API
  participant Config as SoundConfig
  participant Monitor as SnapserverMonitor

  Audio->>API: POST /internal/stop
  API->>API: start 30s demotion timer
  alt audio resumes before timer
    Audio->>API: POST /internal/play
    API->>API: cancel demotion timer
  else no replay
    API->>Config: demoteToIdle()
    API->>Monitor: setMaster(false)
    Config->>Config: restart multiroom containers into standby
  end
```

## Discovery state

```mermaid
flowchart TD
  IdleClient["idle auto/join client"] --> Browse["Avahi browse _snapcast._tcp"]
  Browse --> Filter["filter unusable IPs\nreject lo, 127.0.0.1, 169.254, Docker/veth, IPv6"]
  Filter --> Found["discoveredMasterIp set"]
  Found --> Ready["/multiroom/client-ready true"]
  Ready --> Snapclient["snapclient connects to /multiroom/master"]
  Found --> TTL["probe TCP 1704 every 30s"]
  TTL -->|90s unreachable| Clear["clear master and restart multiroom-client"]
```

## State names to use in issues

Use these names in debugging notes and prompts:

- `disabled-standalone`
- `auto-idle`
- `auto-master-snapcast`
- `auto-master-direct-fallback`
- `auto-remote-client`
- `host-master`
- `join-remote-client`

These names prevent ambiguity around the word "local".
