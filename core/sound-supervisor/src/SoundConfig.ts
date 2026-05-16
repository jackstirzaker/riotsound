import { getIPAddress } from './utils'
import { MultiroomRole, SoundModes } from './types'
import { constants } from './constants'
import { startBalenaService, stopBalenaService, restartBalenaService } from './utils'
import type { ElectedRole } from './ElectionManager'

interface DeviceConfig {
  ip: string
  type: string
}

export default class SoundConfig {
  public role: MultiroomRole = constants.role
  public groupName: string | undefined = constants.groupName
  public device: DeviceConfig = {
    ip: getIPAddress() ?? 'localhost',
    type: constants.balenaDeviceType
  }
  private electedRole: ElectedRole | null = null
  private readonly sourcePlugins = ['airplay', 'librespot', 'bluetooth', 'karaoke', 'karaoke-fetcher']

  private safeService(fn: (s: string) => Promise<unknown>, service: string, attempt = 1): void {
    fn(service).catch((err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 423 && attempt <= 3) {
        const delay = attempt * 2000
        console.log(`Service call locked [${service}] (423), retrying in ${delay}ms (attempt ${attempt}/3)`)
        setTimeout(() => this.safeService(fn, service, attempt + 1), delay)
      } else {
        console.log(`Service call failed [${service}]: ${(err as Error).message}`)
      }
    })
  }

  private startSourcePlugins(): void {
    this.sourcePlugins.forEach((service) => this.safeService(startBalenaService, service))
  }

  private stopSourcePlugins(): void {
    this.sourcePlugins.forEach((service) => this.safeService(stopBalenaService, service))
  }

  private applyRoleServices(): void {
    switch (this.role) {
      case MultiroomRole.HOST:
        // HOST is always master — start everything including server immediately.
        this.safeService(startBalenaService, 'multiroom-server')
        this.safeService(startBalenaService, 'multiroom-client')
        this.startSourcePlugins()
        break
      case MultiroomRole.AUTO:
        // Pre-warm both multiroom containers so they're ready when play fires.
        // Each polls GET /multiroom/active and only starts its main process
        // (pacat / snapclient) once that endpoint returns true.
        this.safeService(startBalenaService, 'multiroom-server')
        this.safeService(startBalenaService, 'multiroom-client')
        this.startSourcePlugins()
        break
      case MultiroomRole.JOIN:
        // Invisible to streaming apps; only snapcast client runs.
        this.safeService(stopBalenaService, 'multiroom-server')
        this.stopSourcePlugins()
        this.safeService(startBalenaService, 'multiroom-client')
        break
      case MultiroomRole.DISABLED:
        // Standalone only; no multiroom participation.
        this.safeService(stopBalenaService, 'multiroom-server')
        this.safeService(stopBalenaService, 'multiroom-client')
        this.startSourcePlugins()
        break
    }
  }

  applyCurrentRole(): void {
    const group = this.groupName ? ` (group: ${this.groupName})` : ''
    console.log(`Applying role on startup: ${this.role}${group}`)
    this.applyRoleServices()
  }

  // Called after promotion. Starts the full multiroom stack for the elected role.
  applyElectionResult(elected: ElectedRole, _hadRemoteMaster = false): void {
    this.electedRole = elected
    if (elected === 'master') {
      this.safeService(startBalenaService, 'multiroom-server')
      // multiroom-client stays running; its watchdog detects the master IP
      // change and respawns snapclient in-place within 5s.
      console.log('[election] Promoted to master — starting multiroom-server + multiroom-client')
      this.safeService(startBalenaService, 'multiroom-client')
    } else {
      console.log('[election] Elected client — starting multiroom-client, stopping multiroom-server')
      this.safeService(stopBalenaService, 'multiroom-server')
      this.safeService(startBalenaService, 'multiroom-client')
    }
  }

  // Called when stop demotion timer fires. Bounces both containers so they
  // re-enter the waiting-for-active state cleanly for the next play event.
  demoteToIdle(): void {
    this.electedRole = null
    console.log('[election] Demoted to idle — bouncing multiroom containers to standby')
    this.safeService(restartBalenaService, 'multiroom-server')
    this.safeService(restartBalenaService, 'multiroom-client')
  }

  isElectedMaster(): boolean {
    if (this.role === MultiroomRole.HOST) return true
    if (this.role === MultiroomRole.AUTO) return this.electedRole === 'master'
    return false
  }

  setRole(role: MultiroomRole): boolean {
    if (!Object.values(MultiroomRole).includes(role)) {
      console.log(`Invalid role: ${role}`)
      return false
    }
    const changed = role !== this.role
    this.role = role
    if (changed) {
      this.applyRoleServices()
    }
    return changed
  }

  setGroupName(name: string): void {
    this.groupName = name || undefined
  }

  getMultiroomStatus() {
    return {
      role: this.role,
      groupName: this.groupName ?? null,
      deviceIp: this.device.ip,
      groupLatency: constants.groupLatency,
      hwLatency: constants.hwLatency
    }
  }

  /** @deprecated Use setRole(). Kept for /mode backward-compat. */
  setMode(mode: SoundModes): boolean {
    console.warn(`[DEPRECATED] POST /mode — use POST /multiroom/role instead`)
    const modeToRole: Record<string, MultiroomRole> = {
      [SoundModes.MULTI_ROOM]: MultiroomRole.AUTO,
      [SoundModes.MULTI_ROOM_CLIENT]: MultiroomRole.JOIN,
      [SoundModes.STANDALONE]: MultiroomRole.DISABLED,
    }
    const role = modeToRole[mode]
    if (!role) {
      console.log(`Unknown mode: ${mode}`)
      return false
    }
    return this.setRole(role)
  }
}
