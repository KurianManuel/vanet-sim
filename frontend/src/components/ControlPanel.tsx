import { useState } from 'react'
import type { SimConfig } from '../types/sim'
import { InfoTip } from './Tooltip'

interface Props {
  onStart: (cfg: SimConfig) => void
  onStop: () => void
  onReset: () => void
  status: 'idle' | 'running' | 'complete' | 'error'
}

const defaults: SimConfig = {
  n_vehicles: 10, n_rsus: 3, sim_time: 60,
  vehicle_speed: 20, rsu_range: 200,
  area_width: 1000, area_height: 500,
}

const FIELD_META = {
  n_vehicles:    { label: 'VEHICLES',      min: 2,   max: 50,   step: 1,   tip: 'Number of vehicles in the simulation. Each vehicle runs the full VANET authentication protocol — registration, authentication, and key exchange.' },
  n_rsus:        { label: 'RSUs',          min: 1,   max: 10,   step: 1,   tip: 'Roadside Units (RSUs) are fixed infrastructure nodes that relay messages between vehicles and the Trust Authority. More RSUs increases coverage.' },
  sim_time:      { label: 'SIM TIME (s)',  min: 10,  max: 300,  step: 10,  tip: 'Total simulation duration in seconds. Longer runs capture more handoff and mobility events.' },
  vehicle_speed: { label: 'SPEED (m/s)',   min: 1,   max: 60,   step: 1,   tip: 'Average speed of vehicles in metres per second. Higher speeds increase handoff frequency as vehicles cross RSU boundaries faster.' },
  rsu_range:     { label: 'RSU RANGE (m)', min: 50,  max: 500,  step: 25,  tip: 'Wireless coverage radius of each RSU in metres. Vehicles outside this range cannot communicate with the RSU and must wait to enter coverage.' },
  area_width:    { label: 'AREA W (m)',    min: 200, max: 2000, step: 100, tip: 'Width of the simulation area in metres. RSUs are distributed evenly along this axis.' },
  area_height:   { label: 'AREA H (m)',    min: 200, max: 2000, step: 100, tip: 'Height of the simulation area in metres. Vehicles move randomly within this bounded region.' },
}

function Field({ fieldKey, value, onChange, disabled }: {
  fieldKey: keyof SimConfig
  value: number
  onChange: (v: number) => void
  disabled: boolean
}) {
  const meta = FIELD_META[fieldKey]
  return (
    <div className="field">
      <div className="field-label-row">
        <span>{meta.label}</span>
        <InfoTip text={meta.tip} />
      </div>
      <div className="field-row">
        <input type="range" min={meta.min} max={meta.max} step={meta.step}
          value={value} disabled={disabled}
          onChange={e => onChange(Number(e.target.value))} />
        <span className="field-val">{value}</span>
      </div>
    </div>
  )
}

export function ControlPanel({ onStart, onStop, onReset, status }: Props) {
  const [cfg, setCfg] = useState<SimConfig>(defaults)
  const running = status === 'running'
  const set = (key: keyof SimConfig) => (v: number) => setCfg(p => ({ ...p, [key]: v }))

  return (
    <div className="control-panel panel">
      <div className="panel-header">
        <span className="panel-label">SIM PARAMETERS</span>
        <span className={`status-dot ${status}`} />
      </div>
      <div className="fields">
        {(Object.keys(FIELD_META) as (keyof SimConfig)[]).map(k => (
          <Field key={k} fieldKey={k} value={cfg[k] as number} onChange={set(k)} disabled={running} />
        ))}
      </div>
      <div className="btn-row">
        {!running
          ? <button className="btn btn-start" onClick={() => onStart(cfg)}>▶ Launch</button>
          : <button className="btn btn-stop" onClick={onStop}>■ Abort</button>
        }
        <button className="btn btn-reset" onClick={onReset} disabled={running}>↺ Reset</button>
      </div>
    </div>
  )
}
