import { spawn, ChildProcess } from 'child_process'

export default class AvahiAdvertiser {
  private process: ChildProcess | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private currentArgs: string[] | null = null

  advertise(name: string, port: number, txt: Record<string, string>): void {
    this.unpublish()
    const txtArgs = Object.entries(txt).map(([k, v]) => `${k}=${v}`)
    this.currentArgs = ['-s', name, '_snapcast._tcp', String(port), ...txtArgs]
    this.spawn()
  }

  unpublish(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    this.currentArgs = null
    if (this.process) {
      this.process.removeAllListeners()
      this.process.kill('SIGTERM')
      this.process = null
      console.log('[mdns-advert] Advertisement unpublished')
    }
  }

  isAdvertising(): boolean {
    return this.process !== null
  }

  private spawn(): void {
    if (!this.currentArgs) return
    const args = this.currentArgs
    console.log(`[mdns-advert] Advertising "${args[1]}" _snapcast._tcp port=${args[3]}`)
    this.process = spawn('avahi-publish', args, { stdio: 'ignore' })
    this.process.on('error', (err) => {
      console.log(`[mdns-advert] avahi-publish error: ${err.message}`)
      this.scheduleRestart()
    })
    this.process.on('exit', (code) => {
      if (this.currentArgs) {
        console.log(`[mdns-advert] avahi-publish exited (${code}), restarting...`)
        this.scheduleRestart()
      }
    })
  }

  private scheduleRestart(): void {
    this.process = null
    if (!this.currentArgs || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawn()
    }, 2000)
  }
}
