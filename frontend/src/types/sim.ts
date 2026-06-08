export interface SimConfig {
  n_vehicles: number
  n_rsus: number
  sim_time: number
  vehicle_speed: number
  rsu_range: number
  area_width: number
  area_height: number
}

export interface PositionEvent {
  event: 'POSITION'
  time: number
  node_id: number
  role: 'vehicle' | 'rsu' | 'ta'
  x: number
  y: number
}

export interface MsgEvent {
  event: 'MSG_SENT' | 'MSG_RECV'
  time: number
  src: number
  dst: number
  msg_type: string
  latency_ms: number
  success: boolean
  phase?: string
  direction?: string
}

export interface MetricEvent {
  event: 'METRIC'
  time: number
  metric: string
  value: number
}

export interface HandoffEvent {
  event: 'HANDOFF'
  time: number
  vehicle_id: number
  from_rsu: number
  to_rsu: number
  success: boolean
}

export interface CollisionEvent {
  event: 'COLLISION'
  time: number
  vehicle_id: number
  count: number
}

export interface MacRetryEvent {
  event: 'MAC_RETRY'
  time: number
  vehicle_id: number
  count: number
}

export interface SimSummary {
  event: 'SIM_COMPLETE'
  avg_registration_latency_ms: number
  avg_auth_latency_ms: number
  avg_key_exchange_latency_ms: number
  avg_rsu_load: number
  total_collisions: number
  total_handoffs: number
  successful_handoffs: number
  failed_handoffs: number
  registered: number
  authenticated: number
  keys_exchanged: number
  msg_counts: Record<string, number>
}

export type SimEvent =
  | PositionEvent
  | MsgEvent
  | MetricEvent
  | HandoffEvent
  | CollisionEvent
  | MacRetryEvent
  | SimSummary
  | { event: 'SIM_CONFIG' | 'SIM_STARTED' | 'SIM_SUMMARY' | 'ERROR'; [key: string]: unknown }

export interface NodePosition {
  x: number
  y: number
}

export interface SimState {
  status: 'idle' | 'running' | 'complete' | 'error'
  time: number
  vehicles: Record<number, NodePosition>
  rsus: Record<number, NodePosition>
  metrics: {
    registration_latency: number[]
    auth_latency: number[]
    key_exchange_latency: number[]
    rsu_load: number[]
  }
  handoffs: HandoffEvent[]
  collisions: number
  msgCounts: Record<string, number>
  summary: SimSummary | null
  errorMsg: string | null
}
