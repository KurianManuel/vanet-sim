import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts'
import type { SimState } from '../types/sim'
import { InfoTip } from './Tooltip'

interface Props { state: SimState }

function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

const STAT_INFO: Record<string, string> = {
  'AVG REG':       'Average registration latency in milliseconds. Measures how long a vehicle takes to complete the initial registration handshake with the Trust Authority via an RSU.',
  'AVG AUTH':      'Average authentication latency. The time for a vehicle to complete the Session Initiation Message exchange and get validated by the RSU via a smart contract call.',
  'AVG KEY EX':    'Average key exchange latency. Time to complete the 3-message GIFT algorithm key exchange between a vehicle and its connected RSU.',
  'AVG RSU LOAD':  'Average RSU load computed as total vehicles divided by RSUs. Higher values indicate potential congestion at individual RSUs.',
  'AVG E2E':       'Average end-to-end delay across all vehicles. Measured from the start of registration to completion of key exchange — the full protocol sequence duration.',
  'THROUGHPUT':    'Network throughput in bits per second. Computed as total protocol bytes successfully transmitted divided by elapsed simulation time.',
  'LOSS RATIO':    'Message loss ratio — fraction of packets that were dropped due to 802.11p signal loss or channel congestion. Computed from Friis path loss model at 5.9 GHz.',
  'PKT FAILED':    'Packets that exhausted all 3 retry attempts and were permanently marked as failed. These represent vehicles that could not complete a protocol phase.',
  'HANDOFFS':      'Total number of handoff events. A handoff occurs when a vehicle moves out of one RSU coverage zone and connects to a new RSU.',
  'H/OFF OK':      'Successful handoffs where the vehicle entered the new RSU\'s coverage zone and re-registered correctly.',
  'H/OFF FAIL':    'Failed handoffs where the vehicle left coverage but did not enter a new RSU zone, resulting in a temporary loss of connectivity.',
  'COLLISIONS':    'Number of wireless packet collisions detected at the 802.11p PHY layer. Collisions occur when multiple nodes transmit simultaneously in overlapping coverage.',
  'REGISTERED':    'Total vehicles that have successfully completed the registration phase with the Trust Authority.',
  'AUTHED':        'Total vehicles that have successfully completed authentication with an RSU.',
  'KEYS EX':       'Total vehicles that have successfully exchanged session keys and are ready for secure communication.',
}

function StatBox({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="stat-box">
      <div className="stat-label-row">
        <span className="stat-label">{label}</span>
        {STAT_INFO[label] && <InfoTip text={STAT_INFO[label]} />}
      </div>
      <div className="stat-value">{value}<span className="stat-unit">{unit}</span></div>
    </div>
  )
}

const tooltipStyle = {
  contentStyle: { background: '#1e1e2e', border: '1px solid #2a2a3e', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, borderRadius: 6 },
  labelStyle: { color: '#94a3b8' },
  itemStyle: { color: '#cdd6f4' },
}

const CHART_INFO = {
  latency:    'Shows per-vehicle registration, authentication, and key exchange latencies over time. Spikes indicate vehicles that experienced higher network delays, often due to distance from RSU or channel congestion.',
  msgDist:    'Count of each protocol message type sent during the simulation. REGISTRATION messages should be highest due to re-registration after handoffs.',
  rsuLoad:    'RSU load ratio over time (vehicles ÷ RSUs). A flat line indicates even load distribution. Sudden increases indicate clustering of vehicles near fewer RSUs.',
  e2e:        'End-to-end delay per vehicle in milliseconds — measured from registration start to key exchange completion. Higher values indicate vehicles that experienced retries or were far from their RSU.',
  throughput: 'Network throughput over time in bits per second. Computed cumulatively — the value at each point reflects total bytes sent divided by elapsed time.',
  lossRatio:  'Cumulative message loss ratio over time. Increases when vehicles move to RSU boundary zones or when channel congestion causes packet drops.',
}

export function MetricsDashboard({ state }: Props) {
  const { metrics, handoffs, collisions, msgCounts, summary } = state
  const latencyData = metrics.registration_latency.map((v, i) => ({
    i,
    reg:  +v.toFixed(2),
    auth: +(metrics.auth_latency[i] ?? 0).toFixed(2),
    key:  +(metrics.key_exchange_latency[i] ?? 0).toFixed(2),
  }))
  const msgData    = Object.entries(msgCounts).map(([name, count]) => ({ name: name.replace(/_/g, ' '), count }))
  const handoffOk  = handoffs.filter(h => h.success).length
  const handoffFail = handoffs.filter(h => !h.success).length
  const e2eData    = metrics.e2e_delay.map((v, i) => ({ i, e2e: +v.toFixed(2) }))
  const tputData   = metrics.throughput_bps.map((v, i) => ({ i, kbps: +(v / 1000).toFixed(2) }))
  const lossData   = metrics.msg_loss_ratio.map((v, i) => ({ i, loss: +(v * 100).toFixed(3) }))

  return (
    <div className="metrics-grid">
      <div className="panel stat-panel">
        <div className="panel-header"><span className="panel-label">PROTOCOL STATISTICS</span></div>
        <div className="stat-grid">
          <StatBox label="AVG REG"      value={avg(metrics.registration_latency).toFixed(2)} unit="ms" />
          <StatBox label="AVG AUTH"     value={avg(metrics.auth_latency).toFixed(2)}          unit="ms" />
          <StatBox label="AVG KEY EX"   value={avg(metrics.key_exchange_latency).toFixed(2)}  unit="ms" />
          <StatBox label="AVG RSU LOAD" value={avg(metrics.rsu_load).toFixed(2)} />
        </div>
        <div className="stat-grid">
          <StatBox label="AVG E2E"    value={avg(metrics.e2e_delay).toFixed(2)}          unit="ms" />
          <StatBox label="THROUGHPUT" value={(avg(metrics.throughput_bps)/1000).toFixed(1)} unit="Kbps" />
          <StatBox label="LOSS RATIO" value={(avg(metrics.msg_loss_ratio)*100).toFixed(2)} unit="%" />
          <StatBox label="PKT FAILED" value={summary?.total_pkt_failed ?? 0} />
        </div>
        <div className="stat-grid">
          <StatBox label="HANDOFFS"   value={handoffs.length} />
          <StatBox label="H/OFF OK"   value={handoffOk} />
          <StatBox label="H/OFF FAIL" value={handoffFail} />
          <StatBox label="COLLISIONS" value={collisions} />
        </div>
        {summary && (
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <StatBox label="REGISTERED" value={summary.registered} />
            <StatBox label="AUTHED"     value={summary.authenticated} />
            <StatBox label="KEYS EX"    value={summary.keys_exchanged} />
          </div>
        )}
      </div>

      <div className="panel chart-panel">
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="panel-label">LATENCY OVER TIME (ms)</span>
            <InfoTip text={CHART_INFO.latency} />
          </div>
        </div>
        {latencyData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={latencyData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f8" />
                <XAxis dataKey="i" hide />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} width={36} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="reg"  stroke="#f59e0b" strokeWidth={2} dot={false} name="REG" />
                <Line type="monotone" dataKey="auth" stroke="#3b82f6" strokeWidth={2} dot={false} name="AUTH" />
                <Line type="monotone" dataKey="key"  stroke="#8b5cf6" strokeWidth={2} dot={false} name="KEY EX" />
              </LineChart>
            </ResponsiveContainer>
            <div className="legend">
              <span className="leg-item" style={{ color: '#f59e0b' }}>■ REG</span>
              <span className="leg-item" style={{ color: '#3b82f6' }}>■ AUTH</span>
              <span className="leg-item" style={{ color: '#8b5cf6' }}>■ KEY EX</span>
            </div>
          </>
        ) : <div className="chart-empty">Awaiting simulation data…</div>}
      </div>

      <div className="panel chart-panel">
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="panel-label">MESSAGE DISTRIBUTION</span>
            <InfoTip text={CHART_INFO.msgDist} />
          </div>
        </div>
        {msgData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={msgData} margin={{ top: 10, right: 16, bottom: 36, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f8" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 8, fontFamily: 'monospace' }} angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} width={36} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="#3b82f6" opacity={0.85} radius={[3, 3, 0, 0]} name="Count" />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty">Awaiting simulation data…</div>}
      </div>

      <div className="panel chart-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="panel-label">RSU LOAD OVER TIME</span>
            <InfoTip text={CHART_INFO.rsuLoad} />
          </div>
        </div>
        {metrics.rsu_load.length > 0 ? (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={metrics.rsu_load.map((v, i) => ({ i, load: +v.toFixed(3) }))} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f8" />
              <XAxis dataKey="i" hide />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} width={36} />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="load" stroke="#22c55e" strokeWidth={2} dot={false} name="Load" />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty">Awaiting simulation data…</div>}
      </div>

      <div className="panel chart-panel">
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="panel-label">END-TO-END DELAY (ms)</span>
            <InfoTip text={CHART_INFO.e2e} />
          </div>
        </div>
        {e2eData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={e2eData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f8" />
              <XAxis dataKey="i" hide />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} width={44} />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="e2e" stroke="#06b6d4" strokeWidth={2} dot={false} name="E2E (ms)" />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty">Awaiting simulation data…</div>}
      </div>

      <div className="panel chart-panel">
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="panel-label">THROUGHPUT (Kbps)</span>
            <InfoTip text={CHART_INFO.throughput} />
          </div>
        </div>
        {tputData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={tputData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f8" />
              <XAxis dataKey="i" hide />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} width={44} />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="kbps" stroke="#22c55e" strokeWidth={2} dot={false} name="Kbps" />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty">Awaiting simulation data…</div>}
      </div>

      <div className="panel chart-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="panel-label">MESSAGE LOSS RATIO (%)</span>
            <InfoTip text={CHART_INFO.lossRatio} />
          </div>
        </div>
        {lossData.length > 0 ? (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={lossData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f8" />
              <XAxis dataKey="i" hide />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} width={44} />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={2} dot={false} name="Loss %" />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty">Awaiting simulation data…</div>}
      </div>
    </div>
  )
}
