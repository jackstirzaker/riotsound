import { spawn, ChildProcess } from 'child_process'

export interface SnapcastService {
  name: string
  ip: string
  port: number
  txt: Record<string, string>
}

// Reject loopback, link-local, Docker/container virtual interfaces, and all IPv6.
// avahi-browse emits one '=' per interface per service, so during startup
// scans the same service can resolve to Docker bridges, link-local IPv6, and
// loopback — all useless as snapcast targets.
// IPv6 is rejected outright: snapclient + PulseAudio on host networking is
// IPv4-only in practice, and IPv6 resolutions of the same host cause master-IP
// instability (the same device resolves as both an IPv4 and IPv6 address,
// producing spurious master-change events and silent connection failures).
function isUsableResolution(iface: string, address: string): boolean {
  // IPv6 — any address containing ':' is IPv6; reject all of them
  if (address.includes(':')) return false
  // Loopback
  if (iface === 'lo') return false
  if (address === '127.0.0.1') return false
  // Link-local
  if (address.startsWith('169.254.')) return false
  // Docker / container virtual interfaces (br-xxx, docker0, veth*)
  if (iface.startsWith('br-') || iface.startsWith('docker') || iface.startsWith('veth')) return false
  return true
}

// Parse a single avahi-browse -p resolved line into a SnapcastService.
// Format: =;iface;proto;name;type;domain;hostname;address;port;txt...
function parseLine(line: string, groupName?: string): SnapcastService | null {
  const parts = line.split(';')
  if (parts.length < 9) return null
  const [, iface, , name, , , , address, portStr, ...txtParts] = parts
  if (!address || !portStr) return null
  if (!isUsableResolution(iface, address)) return null
  const txt: Record<string, string> = {}
  // TXT records are quoted strings: "key=value" — may span remaining fields
  const raw = txtParts.join(';')
  for (const m of raw.matchAll(/"([^"]*)"/g)) {
    const eq = m[1].indexOf('=')
    if (eq > 0) txt[m[1].slice(0, eq)] = m[1].slice(eq + 1)
  }
  if (groupName && txt['group'] !== groupName) return null
  return { name, ip: address, port: parseInt(portStr, 10), txt }
}

// One-shot browse for election: terminate after initial scan with -t.
export function browseSnapcast(
  groupName?: string,
  timeoutMs = 5000,
  _localIp?: string
): Promise<SnapcastService[]> {
  return new Promise((resolve) => {
    // Keyed by service name so multiple resolutions (Docker IPs + real LAN IP)
    // collapse to one entry — last resolution wins (avahi emits them in order,
    // LAN address arrives last).
    const found = new Map<string, SnapcastService>()
    const proc = spawn('avahi-browse', ['-r', '-p', '-t', '_snapcast._tcp'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let buf = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith('=')) continue
        const svc = parseLine(line, groupName)
        if (svc) found.set(svc.name, svc)
      }
    })

    const done = () => resolve([...found.values()])
    proc.on('exit', done)
    proc.on('error', done)

    // Fallback: resolve after timeout in case -t doesn't terminate promptly
    const timer = setTimeout(() => {
      proc.removeAllListeners()
      try { proc.kill() } catch { /* ignore */ }
      resolve([...found.values()])
    }, timeoutMs)

    proc.on('exit', () => clearTimeout(timer))
  })
}

// Persistent browser using avahi-browse (no raw UDP socket — avahi-daemon owns 5353).
// Emits 'up' on service resolved, 'down' on service removed.
// Restarts automatically if avahi-browse exits unexpectedly.
export class SnapcastBrowser {
  private process: ChildProcess | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private running = false
  private knownServices = new Map<string, SnapcastService>()
  private pendingUp = new Map<string, { svc: SnapcastService; timer: NodeJS.Timeout }>()

  constructor(
    private readonly onUp: (svc: SnapcastService) => void,
    private readonly onDown: (svc: SnapcastService) => void,
    private readonly groupName?: string
  ) {}

  start(): void {
    this.running = true
    this.spawn()
  }

  stop(): void {
    this.running = false
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    for (const { timer } of this.pendingUp.values()) clearTimeout(timer)
    this.pendingUp.clear()
    if (this.process) {
      this.process.removeAllListeners()
      try { this.process.kill('SIGTERM') } catch { /* ignore */ }
      this.process = null
    }
    this.knownServices.clear()
  }

  private spawn(): void {
    if (!this.running) return
    let buf = ''
    this.process = spawn('avahi-browse', ['-r', '-p', '_snapcast._tcp'], { stdio: ['ignore', 'pipe', 'ignore'] })

    this.process.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const line of lines) this.handleLine(line)
    })

    this.process.on('error', () => this.scheduleRestart())
    this.process.on('exit', () => this.scheduleRestart())
  }

  private handleLine(line: string): void {
    const parts = line.split(';')
    const type = parts[0]
    const name = parts[3]

    if (type === '=') {
      const svc = parseLine(line, this.groupName)
      if (!svc) return
      // avahi-browse -r emits one '=' per interface per address, so Docker
      // bridge IPs arrive ~100ms before the real LAN IP for the same service.
      // Debounce 200ms so the burst settles; onUp fires once with the final IP.
      const existing = this.pendingUp.get(name)
      if (existing) clearTimeout(existing.timer)
      const timer = setTimeout(() => {
        this.pendingUp.delete(name)
        this.knownServices.set(name, svc)
        this.onUp(svc)
      }, 200)
      this.pendingUp.set(name, { svc, timer })
    } else if (type === '-') {
      const pending = this.pendingUp.get(name)
      if (pending) { clearTimeout(pending.timer); this.pendingUp.delete(name) }
      const svc = this.knownServices.get(name)
      if (svc) {
        this.knownServices.delete(name)
        this.onDown(svc)
      }
    }
  }

  private scheduleRestart(): void {
    this.process = null
    if (!this.running || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawn()
    }, 1000)
  }
}
