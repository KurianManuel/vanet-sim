import { useState } from 'react'
import { useSimulation } from './hooks/useSimulation'
import { useComparison } from './hooks/useComparison'
import { useLog } from './hooks/useLog'
import { ControlPanel } from './components/ControlPanel'
import { TopologyMap } from './components/TopologyMap'
import { MetricsDashboard } from './components/MetricsDashboard'
import { ComparisonPanel } from './components/ComparisonPanel'
import { LogPanel } from './components/LogPanel'
import type { SimConfig } from './types/sim'
import type { LogEntry } from './types/log'

const defaultConfig: SimConfig = {
  n_vehicles: 20, n_rsus: 2, sim_time: 60,
  vehicle_speed: 40, rsu_range: 75,
  area_width: 2000, area_height: 500,
}

type Tab = 'monitor' | 'compare'

export default function App() {
  const log = useLog()
  const { state, start, stop, reset } = useSimulation(log.processEvent)
  const { runs, addRun, removeRun, clearAll } = useComparison()
  const [config, setConfig] = useState<SimConfig>(defaultConfig)
  const [tab, setTab] = useState<Tab>('monitor')
  const [prevComplete, setPrevComplete] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (state.status === 'complete' && state.summary && !prevComplete) {
    setPrevComplete(true)
    addRun({ config, summary: state.summary, metrics: state.metrics, logs: log.allEntries })
  }
  if (state.status !== 'complete' && prevComplete) setPrevComplete(false)

  const handleStart = (cfg: SimConfig) => {
    setConfig(cfg)
    log.clear()
    start(cfg)
    setTab('monitor')
    setSelectedRunId(null)
    setSidebarOpen(false)
  }

  const isCompareTab = tab === 'compare'
  const selectedRun = runs.find(r => r.id === selectedRunId)
  const footerLogs: LogEntry[] = isCompareTab && selectedRun ? selectedRun.logs : log.entries
  const footerTotal = isCompareTab && selectedRun ? selectedRun.logs.length : log.allEntries.length
  const footerLabel = isCompareTab && selectedRun ? `${selectedRun.label} LOG` : 'LIVE LOG'

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="header-logo">VANET</div>
          <div className="header-sub">NETWORK SIMULATION MONITOR</div>
        </div>
        <div className="header-center">
          <div className="tab-bar">
            <button className={`tab-btn ${tab === 'monitor' ? 'active' : ''}`} onClick={() => setTab('monitor')}>
              Monitor
            </button>
            <button className={`tab-btn ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>
              Compare
              {runs.length > 0 && <span className="tab-badge">{runs.length}</span>}
            </button>
          </div>
        </div>
        <div className="header-right">
          <span className={`header-badge ${state.status}`}>{state.status.toUpperCase()}</span>
          {state.status === 'running' && (
            <span className="header-time">T={state.time.toFixed(1)}s</span>
          )}
        </div>
      </header>

      {state.errorMsg && <div className="error-bar">⚠ {state.errorMsg}</div>}

      {state.status === 'complete' && tab === 'monitor' && (
        <div className="saved-bar">
          ✓ Run saved to comparison.{' '}
          <button className="saved-link" onClick={() => setTab('compare')}>View comparison →</button>
        </div>
      )}

      <main className="app-main">
        <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(p => !p)}>
            <span>⚙ SIM PARAMETERS</span>
            <span className="sidebar-toggle-icon">▼</span>
          </button>
          <ControlPanel onStart={handleStart} onStop={stop} onReset={reset} status={state.status} />
        </aside>

        <section className="app-content">
          {tab === 'monitor' ? (
            <>
              <TopologyMap state={state} config={config} />
              <MetricsDashboard state={state} />
            </>
          ) : (
            <ComparisonPanel
              runs={runs}
              onRemove={removeRun}
              onClear={clearAll}
              selectedRunId={selectedRunId}
              onSelectRun={setSelectedRunId}
            />
          )}
        </section>
      </main>

      <LogPanel
        entries={footerLogs}
        totalCount={footerTotal}
        label={footerLabel}
        filter={log.filter}
        setFilter={log.setFilter}
        paused={log.paused}
        onTogglePause={log.togglePause}
        onClear={log.clear}
        isHistoric={isCompareTab && selectedRun !== undefined}
      />
    </div>
  )
}
