import type { SimConfig, SimSummary } from './sim'
import type { LogEntry } from './log'

export interface RunRecord {
  id: number
  label: string
  config: SimConfig
  summary: SimSummary
  metrics: {
    registration_latency: number[]
    auth_latency: number[]
    key_exchange_latency: number[]
    rsu_load: number[]
    e2e_delay: number[]
    throughput_bps: number[]
    msg_loss_ratio: number[]
  }
  logs: LogEntry[]
  completedAt: number
}

export interface ComparisonStore {
  runs: RunRecord[]
  addRun: (run: Omit<RunRecord, 'id' | 'label' | 'completedAt'>) => void
  removeRun: (id: number) => void
  clearAll: () => void
}
