export type LogLevel = 'info' | 'success' | 'warning' | 'error'

export type LogCategory =
  | 'REGISTRATION'
  | 'AUTHENTICATION'
  | 'KEY_EXCHANGE'
  | 'HANDOFF'
  | 'COLLISION'
  | 'MAC_RETRY'
  | 'METRIC'
  | 'SYSTEM'

export interface LogEntry {
  id: number
  simTime: number
  wallTime: number
  level: LogLevel
  category: LogCategory
  message: string
  detail?: string
  success?: boolean
  src?: number
  dst?: number
}
