import { useEffect, useRef, useState } from 'react'
import type { LogEntry, LogCategory } from '../types/log'
import type { LogFilter } from '../hooks/useLog'

interface Props {
  entries: LogEntry[]
  filter: LogFilter
  setFilter: (f: LogFilter) => void
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
  totalCount: number
}

const LEVEL_COLOR: Record<string, string> = {
  info:    '#94a3b8',
  success: '#22c55e',
  warning: '#f59e0b',
  error:   '#ef4444',
}

const LEVEL_BG: Record<string, string> = {
  info:    'rgba(148,163,184,0.08)',
  success: 'rgba(34,197,94,0.06)',
  warning: 'rgba(245,158,11,0.08)',
  error:   'rgba(239,68,68,0.08)',
}

const CAT_SHORT: Record<LogCategory, string> = {
  REGISTRATION:   'REG',
  AUTHENTICATION: 'AUTH',
  KEY_EXCHANGE:   'KEY',
  HANDOFF:        'HO',
  COLLISION:      'COL',
  MAC_RETRY:      'MAC',
  METRIC:         'MET',
  SYSTEM:         'SYS',
}

const CAT_COLOR: Record<LogCategory, string> = {
  REGISTRATION:   '#3b82f6',
  AUTHENTICATION: '#8b5cf6',
  KEY_EXCHANGE:   '#06b6d4',
  HANDOFF:        '#f59e0b',
  COLLISION:      '#ef4444',
  MAC_RETRY:      '#f97316',
  METRIC:         '#6b7280',
  SYSTEM:         '#94a3b8',
}

function LogRow({ entry, expanded, onToggle }: {
  entry: LogEntry
  expanded: boolean
  onToggle: () => void
}) {
  const ts = new Date(entry.wallTime).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 2 })

  return (
    <div
      className="log-row"
      style={{ background: expanded ? LEVEL_BG[entry.level] : undefined }}
      onClick={onToggle}
    >
      <span className="log-wall">{ts}</span>
      <span className="log-sim">[{entry.simTime.toFixed(2)}s]</span>
      <span className="log-cat" style={{ color: CAT_COLOR[entry.category], borderColor: CAT_COLOR[entry.category] }}>
        {CAT_SHORT[entry.category]}
      </span>
      <span className="log-level" style={{ color: LEVEL_COLOR[entry.level] }}>
        {entry.level.toUpperCase()}
      </span>
      <span className="log-msg">{entry.message}</span>
      {entry.detail && <span className="log-expand-icon">{expanded ? '▲' : '▼'}</span>}
      {expanded && entry.detail && (
        <div className="log-detail">{entry.detail}</div>
      )}
    </div>
  )
}

export function LogPanel({ entries, filter, setFilter, paused, onTogglePause, onClear, totalCount }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && !collapsed && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries, autoScroll, collapsed])

  const handleScroll = () => {
    if (!listRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  return (
    <div className={`log-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="log-header">
        <div className="log-header-left">
          <span className="log-title">EVENT LOG</span>
          <span className="log-count">{entries.length.toLocaleString()} / {totalCount.toLocaleString()} entries</span>
        </div>
        <div className="log-header-center">
          {(['protocol', 'errors', 'all'] as LogFilter[]).map(f => (
            <button
              key={f}
              className={`log-filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'protocol' ? 'Protocol' : f === 'errors' ? 'Errors & Warnings' : 'All'}
            </button>
          ))}
        </div>
        <div className="log-header-right">
          {!autoScroll && (
            <button className="log-ctrl-btn" onClick={() => {
              setAutoScroll(true)
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}>↓ Latest</button>
          )}
          <button className={`log-ctrl-btn ${paused ? 'paused' : ''}`} onClick={onTogglePause}>
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button className="log-ctrl-btn" onClick={onClear}>✕ Clear</button>
          <button className="log-ctrl-btn collapse-btn" onClick={() => setCollapsed(p => !p)}>
            {collapsed ? '▲ Log' : '▼'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="log-list" ref={listRef} onScroll={handleScroll}>
          {entries.length === 0 ? (
            <div className="log-empty">Waiting for simulation events…</div>
          ) : (
            entries.map(e => (
              <LogRow
                key={e.id}
                entry={e}
                expanded={expandedId === e.id}
                onToggle={() => setExpandedId(p => p === e.id ? null : e.id)}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
