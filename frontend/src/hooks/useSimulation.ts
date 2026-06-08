import { useState, useRef, useCallback } from 'react'
import type { SimConfig, SimState, SimEvent, HandoffEvent, SimSummary } from '../types/sim'

const WS_URL = 'ws://localhost:8000/simulate'

const initialState = (): SimState => ({
  status: 'idle',
  time: 0,
  vehicles: {},
  rsus: {},
  metrics: {
    registration_latency: [],
    auth_latency: [],
    key_exchange_latency: [],
    rsu_load: [],
  },
  handoffs: [],
  collisions: 0,
  msgCounts: {},
  summary: null,
  errorMsg: null,
})

export function useSimulation(onEvent?: (e: SimEvent) => void) {
  const [state, setState] = useState<SimState>(initialState())
  const wsRef = useRef<WebSocket | null>(null)

  const processEvent = useCallback((event: SimEvent) => {
    setState(prev => {
      const next = { ...prev }

      if (event.event === 'SIM_STARTED') {
        return { ...initialState(), status: 'running' }
      }

      if (event.event === 'POSITION') {
        const e = event as Extract<SimEvent, { event: 'POSITION' }>
        next.time = e.time
        if (e.role === 'vehicle') {
          next.vehicles = { ...prev.vehicles, [e.node_id]: { x: e.x, y: e.y } }
        } else if (e.role === 'rsu') {
          next.rsus = { ...prev.rsus, [e.node_id]: { x: e.x, y: e.y } }
        }
        return next
      }

      if (event.event === 'METRIC') {
        const e = event as Extract<SimEvent, { event: 'METRIC' }>
        const metrics = { ...prev.metrics }
        if (e.metric === 'registration_latency_ms') metrics.registration_latency = [...prev.metrics.registration_latency, e.value]
        if (e.metric === 'auth_latency_ms') metrics.auth_latency = [...prev.metrics.auth_latency, e.value]
        if (e.metric === 'key_exchange_latency_ms') metrics.key_exchange_latency = [...prev.metrics.key_exchange_latency, e.value]
        if (e.metric === 'rsu_load') metrics.rsu_load = [...prev.metrics.rsu_load, e.value]
        next.metrics = metrics
        return next
      }

      if (event.event === 'HANDOFF') {
        next.handoffs = [...prev.handoffs, event as HandoffEvent]
        return next
      }

      if (event.event === 'COLLISION') {
        next.collisions = prev.collisions + 1
        return next
      }

      if (event.event === 'MSG_SENT') {
        const e = event as Extract<SimEvent, { event: 'MSG_SENT' }>
        next.msgCounts = { ...prev.msgCounts, [e.msg_type]: (prev.msgCounts[e.msg_type] || 0) + 1 }
        return next
      }

      if (event.event === 'SIM_COMPLETE') {
        next.status = 'complete'
        next.summary = event as SimSummary
        return next
      }

      if (event.event === 'ERROR') {
        next.status = 'error'
        next.errorMsg = String((event as Record<string, unknown>).msg ?? 'Unknown error')
        return next
      }

      return next
    })
  }, [])

  const start = useCallback((config: SimConfig) => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    setState(initialState())
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify(config))
    }

    ws.onmessage = (msg) => {
      try {
        const event: SimEvent = JSON.parse(msg.data)
        processEvent(event)
        onEvent?.(event)
      } catch {
        // ignore malformed
      }
    }

    ws.onerror = () => {
      setState(prev => ({ ...prev, status: 'error', errorMsg: 'WebSocket connection failed' }))
    }

    ws.onclose = () => {
      setState(prev => {
        if (prev.status === 'running') return { ...prev, status: 'error', errorMsg: 'Connection closed unexpectedly' }
        return prev
      })
    }
  }, [processEvent])

  const stop = useCallback(() => {
    wsRef.current?.close()
    setState(prev => ({ ...prev, status: 'idle' }))
  }, [])

  const reset = useCallback(() => {
    wsRef.current?.close()
    setState(initialState())
  }, [])

  return { state, start, stop, reset }
}
