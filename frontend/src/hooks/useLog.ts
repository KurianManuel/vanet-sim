import { useState, useCallback, useRef } from 'react'
import type { LogEntry, LogCategory, LogLevel } from '../types/log'
import type { SimEvent } from '../types/sim'

const MAX_ENTRIES = 2000

let idCounter = 0

function makeEntry(
  simTime: number,
  level: LogLevel,
  category: LogCategory,
  message: string,
  opts?: Partial<LogEntry>
): LogEntry {
  return {
    id: ++idCounter,
    simTime,
    wallTime: Date.now(),
    level,
    category,
    message,
    ...opts,
  }
}

function eventToEntry(event: SimEvent): LogEntry | null {
  const t = event.event

  if (t === 'MSG_SENT' || t === 'MSG_RECV') {
    const e = event as Extract<SimEvent, { event: 'MSG_SENT' | 'MSG_RECV' }>
    const phase = (e as Record<string, unknown>).phase as string | undefined
    const dir   = (e as Record<string, unknown>).direction as string | undefined
    const retry = (e as Record<string, unknown>).retry as number | undefined
    const failed = (e as Record<string, unknown>).failed as boolean | undefined

    let category: LogCategory = 'REGISTRATION'
    if (e.msg_type.startsWith('AUTH'))        category = 'AUTHENTICATION'
    else if (e.msg_type.startsWith('KEY'))    category = 'KEY_EXCHANGE'

    const label = t === 'MSG_SENT' ? '→' : '←'

    let detail: string
    if (!e.success && failed) {
      detail = `Packet permanently lost after 3 retries. Vehicle was likely outside RSU coverage (>${ (e as Record<string,unknown>).bytes ?? '?'}B dropped). Protocol phase cannot complete until vehicle re-enters range.`
    } else if (!e.success && retry) {
      detail = `Packet dropped by 802.11p channel (attempt ${retry}/3). Cause: log-normal shadowing or Rayleigh fading pushed received signal below -80 dBm threshold. Retrying with ${retry === 1 ? '500' : retry === 2 ? '1000' : '2000'}ms backoff.`
    } else if (!e.success) {
      detail = `Packet dropped by 802.11p PHY layer — received signal power fell below -80 dBm sensitivity threshold. Retrying…`
    } else {
      detail = [
        phase ? `phase: ${phase}` : null,
        dir   ? `dir: ${dir}` : null,
        `latency: ${e.latency_ms.toFixed(2)}ms`,
      ].filter(Boolean).join(' | ')
    }

    return makeEntry(
      e.time,
      e.success ? 'success' : (failed ? 'error' : 'warning'),
      category,
      `${label} ${e.msg_type}  node ${e.src} → node ${e.dst}`,
      { detail, success: e.success, src: e.src, dst: e.dst }
    )
  }

  if (t === 'HANDOFF') {
    const e = event as Extract<SimEvent, { event: 'HANDOFF' }>
    return makeEntry(
      e.time,
      e.success ? 'success' : 'warning',
      'HANDOFF',
      `Vehicle ${e.vehicle_id} handed off RSU-${e.from_rsu} → RSU-${e.to_rsu}`,
      {
        detail: e.success ? 'Re-registration triggered' : 'Vehicle left coverage — connection lost',
        success: e.success,
      }
    )
  }

  if (t === 'COLLISION') {
    const e = event as Extract<SimEvent, { event: 'COLLISION' }>
    return makeEntry(
      e.time,
      'warning',
      'COLLISION',
      `PHY collision on vehicle ${e.vehicle_id} (total: ${e.count})`,
      { detail: '802.11p packet dropped at physical layer', success: false }
    )
  }

  if (t === 'MAC_RETRY') {
    const e = event as Extract<SimEvent, { event: 'MAC_RETRY' }>
    return makeEntry(
      e.time,
      'warning',
      'MAC_RETRY',
      `MAC retry on vehicle ${e.vehicle_id} (total: ${e.count})`,
      { detail: '802.11p transmission retry', success: false }
    )
  }

  if (t === 'SIM_STARTED') {
    return makeEntry(0, 'info', 'SYSTEM', 'Simulation started', { detail: 'NS-3 process launched' })
  }

  if (t === 'SIM_COMPLETE') {
    return makeEntry(
      (event as Record<string, unknown>).sim_time as number ?? 0,
      'info', 'SYSTEM',
      'Simulation complete',
      { detail: 'All events processed — run saved to comparison' }
    )
  }

  if (t === 'ERROR') {
    return makeEntry(
      0, 'error', 'SYSTEM',
      `Error: ${String((event as Record<string, unknown>).msg ?? 'Unknown')}`,
      { success: false }
    )
  }

  return null
}

export type LogFilter = 'all' | 'protocol' | 'errors'

export function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<LogFilter>('protocol')
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)

  const processEvent = useCallback((event: SimEvent) => {
    if (pausedRef.current) return
    const entry = eventToEntry(event)
    if (!entry) return
    setEntries(prev => {
      const next = [...prev, entry]
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
    })
  }, [])

  const clear = useCallback(() => setEntries([]), [])

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current
    setPaused(p => !p)
  }, [])

  const filtered = entries.filter(e => {
    if (filter === 'all') return true
    if (filter === 'errors') return e.level === 'error' || e.level === 'warning'
    // protocol: registration, auth, key exchange, handoff, system
    return ['REGISTRATION', 'AUTHENTICATION', 'KEY_EXCHANGE', 'HANDOFF', 'SYSTEM'].includes(e.category)
  })

  return { entries: filtered, allEntries: entries, processEvent, clear, filter, setFilter, paused, togglePause }
}
