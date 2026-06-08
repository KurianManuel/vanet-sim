import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import type { RunRecord } from '../types/comparison'
import { RUN_COLORS } from '../hooks/useComparison'
import { InfoTip } from './Tooltip'

interface Props {
  runs: RunRecord[]
  onRemove: (id: number) => void
  onClear: () => void
}

function avg(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

const COMPARE_METRICS = [
  { key: 'avg_registration_latency_ms', label: 'AVG REG',      unit: 'ms', tip: 'Average registration latency across all vehicles in this run.' },
  { key: 'avg_auth_latency_ms',         label: 'AVG AUTH',     unit: 'ms', tip: 'Average authentication latency per vehicle.' },
  { key: 'avg_key_exchange_latency_ms', label: 'AVG KEY EX',   unit: 'ms', tip: 'Average key exchange latency per vehicle.' },
  { key: 'total_handoffs',              label: 'HANDOFFS',     unit: '',   tip: 'Total handoff events where a vehicle changed RSU.' },
  { key: 'successful_handoffs',         label: 'H/OFF OK',     unit: '',   tip: 'Handoffs where vehicle successfully re-registered with new RSU.' },
  { key: 'failed_handoffs',             label: 'H/OFF FAIL',   unit: '',   tip: 'Handoffs where vehicle left coverage without entering a new RSU zone.' },
  { key: 'total_collisions',            label: 'COLLISIONS',   unit: '',   tip: 'Total 802.11p PHY layer collisions detected.' },
  { key: 'registered',                  label: 'REGISTERED',   unit: '',   tip: 'Vehicles that completed registration by end of simulation.' },
  { key: 'authenticated',               label: 'AUTHED',       unit: '',   tip: 'Vehicles that completed authentication by end of simulation.' },
  { key: 'keys_exchanged',              label: 'KEYS EX',      unit: '',   tip: 'Vehicles that completed key exchange by end of simulation.' },
]

function buildChartData(runs: RunRecord[], metricKey: 'registration_latency' | 'auth_latency' | 'key_exchange_latency' | 'rsu_load') {
  if (!runs.length) return []
  const maxLen = Math.max(...runs.map(r => r.metrics[metricKey].length))
  return Array.from({ length: maxLen }, (_, i) => {
    const point: Record<string, number> = { i }
    runs.forEach(r => {
      const val = r.metrics[metricKey][i]
      if (val !== undefined) point[r.label] = +val.toFixed(2)
    })
    return point
  })
}

const tooltipStyle = {
  contentStyle: { background: '#1e1e2e', border: '1px solid #2a2a3e', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, borderRadius: 6 },
  labelStyle: { color: '#94a3b8' },
}

export function ComparisonPanel({ runs, onRemove, onClear }: Props) {
  if (runs.length === 0) {
    return (
      <div className="panel comparison-empty">
        <div className="panel-header"><span className="panel-label">COMPARISON</span></div>
        <div className="comparison-placeholder">
          <div className="placeholder-icon">⊞</div>
          <div className="placeholder-text">Complete a simulation to add it here.</div>
          <div className="placeholder-sub">Up to 5 runs can be compared. Results are cleared when you leave the page.</div>
        </div>
      </div>
    )
  }

  const regData  = buildChartData(runs, 'registration_latency')
  const authData = buildChartData(runs, 'auth_latency')
  const keyData  = buildChartData(runs, 'key_exchange_latency')
  const loadData = buildChartData(runs, 'rsu_load')

  return (
    <div className="comparison-wrapper">
      <div className="panel">
        <div className="panel-header">
          <span className="panel-label">SIMULATION COMPARISON ({runs.length}/5 runs)</span>
          <button className="btn-clear" onClick={onClear}>✕ Clear All</button>
        </div>

        {/* Run badges */}
        <div className="run-badges">
          {runs.map((r, i) => (
            <div key={r.id} className="run-badge" style={{ borderColor: RUN_COLORS[i] }}>
              <span className="run-badge-dot" style={{ background: RUN_COLORS[i] }} />
              <span className="run-badge-label">{r.label}</span>
              <span className="run-badge-cfg">
                {r.config.n_vehicles}V / {r.config.n_rsus}R / {r.config.sim_time}s / {r.config.vehicle_speed}m/s
              </span>
              <button className="run-badge-remove" onClick={() => onRemove(r.id)}>✕</button>
            </div>
          ))}
        </div>

        {/* Stat comparison table */}
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th className="compare-th metric-col">METRIC</th>
                {runs.map((r, i) => (
                  <th key={r.id} className="compare-th" style={{ color: RUN_COLORS[i] }}>{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_METRICS.map(m => (
                <tr key={m.key} className="compare-row">
                  <td className="compare-td metric-col">
                    <div className="metric-label-row">
                      {m.label}
                      <InfoTip text={m.tip} />
                    </div>
                  </td>
                  {runs.map((r, i) => {
                    const val = (r.summary as Record<string, unknown>)[m.key]
                    const display = typeof val === 'number' ? val.toFixed(m.unit === 'ms' ? 1 : 0) : '—'
                    // Highlight best value
                    const allVals = runs.map(rx => Number((rx.summary as Record<string, unknown>)[m.key] ?? 0))
                    const isBest = m.unit === 'ms'
                      ? Number(display) === Math.min(...allVals)
                      : Number(display) === Math.max(...allVals)
                    return (
                      <td key={r.id} className={`compare-td ${isBest && runs.length > 1 ? 'best-val' : ''}`}>
                        {display}{m.unit && <span className="compare-unit">{m.unit}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Overlaid charts */}
      <div className="compare-charts">
        {[
          { data: regData,  title: 'REGISTRATION LATENCY (ms)',  tip: 'Registration latency per vehicle across all runs. Lower is better.' },
          { data: authData, title: 'AUTH LATENCY (ms)',           tip: 'Authentication latency per vehicle across all runs.' },
          { data: keyData,  title: 'KEY EXCHANGE LATENCY (ms)',   tip: 'Key exchange latency per vehicle across all runs.' },
          { data: loadData, title: 'RSU LOAD',                    tip: 'RSU load ratio over time across all runs. Higher values indicate more vehicles per RSU.' },
        ].map(({ data, title, tip }) => (
          <div key={title} className="panel chart-panel">
            <div className="panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="panel-label">{title}</span>
                <InfoTip text={tip} />
              </div>
            </div>
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f8" />
                  <XAxis dataKey="i" hide />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} width={40} />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'monospace', paddingTop: 4 }} />
                  {runs.map((r, i) => (
                    <Line key={r.id} type="monotone" dataKey={r.label}
                      stroke={RUN_COLORS[i]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">No data</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
