import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { SimState } from '../types/sim'

interface Props {
  state: SimState
  config: { area_width: number; area_height: number; rsu_range: number; n_vehicles: number }
}

const W = 800
const H = 300
const ROAD_TOP = 100
const ROAD_BOT = 200
const LANE_MID = (ROAD_TOP + ROAD_BOT) / 2
const LANE1_Y = ROAD_TOP + (ROAD_BOT - ROAD_TOP) * 0.25
const LANE2_Y = ROAD_TOP + (ROAD_BOT - ROAD_TOP) * 0.75
const RSU_POLE_TOP = ROAD_TOP - 50
const RSU_POLE_BOT = ROAD_BOT + 50

export function TopologyMap({ state, config }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  const sx = d3.scaleLinear().domain([0, config.area_width]).range([40, W - 40])
  const rsuScreenXs = Array.from({ length: config.n_rsus }, (_, i) =>
    sx((config.area_width / (config.n_rsus + 1)) * (i + 1))
  )

  useEffect(() => {
    const svg = d3.select(svgRef.current)

    // Vehicles: use NS3 x for road position, lane from id parity
    const vData = Object.entries(state.vehicles).map(([id, pos]) => {
      const vid = Number(id)
      const laneY = vid % 2 === 0 ? LANE1_Y : LANE2_Y
      return { id: vid, x: sx(pos.x), y: laneY, ltr: vid % 2 === 0 }
    })

    const vNodes = svg.selectAll<SVGGElement, typeof vData[0]>('.vehicle-g')
      .data(vData, d => String(d.id))

    const vEnter = vNodes.enter().append('g').attr('class', 'vehicle-g')
    vEnter.append('rect')
      .attr('class', 'vehicle-body')
      .attr('width', 18).attr('height', 10)
      .attr('rx', 3)
      .attr('x', -9).attr('y', -5)
    vEnter.append('text')
      .attr('class', 'vehicle-label')
      .attr('y', -9)
      .attr('text-anchor', 'middle')

    const allV = vEnter.merge(vNodes)
    allV.transition().duration(950).ease(d3.easeLinear)
      .attr('transform', d => `translate(${d.x},${d.y})`)
    allV.select('text').text(d => `V${d.id}`)
    vNodes.exit().remove()

    // RSU coverage arcs
    const rsuData = Object.entries(state.rsus).map(([id, pos]) => ({
      id: Number(id),
      sx: sx(pos.x),
    }))

    const coverageR = (config.rsu_range / config.area_width) * (W - 80)

    const arcs = svg.selectAll<SVGEllipseElement, typeof rsuData[0]>('.rsu-coverage')
      .data(rsuData, d => String(d.id))
    arcs.enter().append('ellipse').attr('class', 'rsu-coverage')
      .merge(arcs)
      .attr('cx', d => d.sx)
      .attr('cy', LANE_MID)
      .attr('rx', coverageR)
      .attr('ry', (ROAD_BOT - ROAD_TOP) / 2 + 20)
    arcs.exit().remove()

    // RSU pulse rings on handoff
    const lastHandoff = state.handoffs[state.handoffs.length - 1]
    if (lastHandoff) {
      const rsuIdx = lastHandoff.to_rsu - config.n_vehicles
      if (rsuIdx >= 0 && rsuIdx < rsuScreenXs.length) {
        const px = rsuScreenXs[rsuIdx]
        const pulse = svg.append('circle')
          .attr('class', 'handoff-pulse')
          .attr('cx', px).attr('cy', LANE_MID)
          .attr('r', 10).attr('fill', 'none')
          .attr('stroke', lastHandoff.success ? '#22c55e' : '#ef4444')
          .attr('stroke-width', 2).attr('opacity', 0.9)
        pulse.transition().duration(800)
          .attr('r', coverageR * 0.6).attr('opacity', 0)
          .remove()
      }
    }
  }, [state.vehicles, state.rsus, state.handoffs, sx, config.rsu_range, config.area_width, config.n_vehicles, rsuScreenXs])

  const dashLen = 40
  const dashGap = 30
  const numDashes = Math.ceil(W / (dashLen + dashGap))

  return (
    <div className="panel topology-panel">
      <div className="panel-header">
        <span className="panel-label">NETWORK TOPOLOGY — HIGHWAY VIEW</span>
        <span className="panel-time">T = {state.time.toFixed(1)}s</span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="topo-svg" style={{ minHeight: 220 }}>
        <defs>
          <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a1a2e" />
            <stop offset="100%" stopColor="#16213e" />
          </linearGradient>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0f1e" />
            <stop offset="100%" stopColor="#111827" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Sky */}
        <rect width={W} height={ROAD_TOP} fill="url(#skyGrad)" />

        {/* Ground below road */}
        <rect y={ROAD_BOT} width={W} height={H - ROAD_BOT} fill="#0d1117" />

        {/* Road surface */}
        <rect y={ROAD_TOP} width={W} height={ROAD_BOT - ROAD_TOP} fill="url(#roadGrad)" />

        {/* Road edges */}
        <line x1={0} y1={ROAD_TOP} x2={W} y2={ROAD_TOP} stroke="#f59e0b" strokeWidth={2.5} opacity={0.7} />
        <line x1={0} y1={ROAD_BOT} x2={W} y2={ROAD_BOT} stroke="#f59e0b" strokeWidth={2.5} opacity={0.7} />

        {/* Lane dividers */}
        <line x1={0} y1={LANE_MID} x2={W} y2={LANE_MID} stroke="#4b5563" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />

        {/* Center dashes */}
        {Array.from({ length: numDashes }, (_, i) => (
          <line key={i}
            x1={i * (dashLen + dashGap)} y1={LANE_MID}
            x2={i * (dashLen + dashGap) + dashLen} y2={LANE_MID}
            stroke="#6b7280" strokeWidth={1.5} opacity={0.4}
          />
        ))}

        {/* RSU poles and heads */}
        {rsuScreenXs.map((x, i) => (
          <g key={i}>
            {/* Coverage ellipse drawn below */}
            {/* Pole above road */}
            <line x1={x} y1={RSU_POLE_TOP} x2={x} y2={ROAD_TOP} stroke="#6b7280" strokeWidth={2} opacity={0.7} />
            {/* Pole below road */}
            <line x1={x} y1={ROAD_BOT} x2={x} y2={RSU_POLE_BOT} stroke="#6b7280" strokeWidth={2} opacity={0.7} />
            {/* Crossbar */}
            <line x1={x - 12} y1={RSU_POLE_TOP + 6} x2={x + 12} y2={RSU_POLE_TOP + 6} stroke="#6b7280" strokeWidth={2} opacity={0.7} />
            {/* RSU head */}
            <rect x={x - 10} y={RSU_POLE_TOP - 4} width={20} height={12} rx={2}
              fill="#f59e0b" filter="url(#glow)" opacity={0.9} />
            {/* Signal indicator dot */}
            <circle cx={x} cy={RSU_POLE_TOP + 2} r={3} fill="#fff" opacity={0.6} />
            {/* Label */}
            <text x={x} y={RSU_POLE_TOP - 10} textAnchor="middle"
              fill="#f59e0b" fontSize={9} fontFamily="JetBrains Mono, monospace" opacity={0.9}>
              RSU-{i}
            </text>
          </g>
        ))}

        {/* Stars in sky */}
        {Array.from({ length: 30 }, (_, i) => {
          const sx2 = (i * 97 + 13) % (W - 20) + 10
          const sy2 = (i * 53 + 7) % (ROAD_TOP - 20) + 5
          return <circle key={i} cx={sx2} cy={sy2} r={0.8} fill="white" opacity={0.3 + (i % 3) * 0.2} />
        })}

        {/* Vehicles and RSU coverage rendered by D3 */}
      </svg>
      <div className="topo-legend">
        <div className="leg-item">
          <div className="leg-dot" style={{ background: '#3b82f6' }} /> Vehicle
        </div>
        <div className="leg-item">
          <div className="leg-dot" style={{ background: '#f59e0b' }} /> RSU (Roadside Unit)
        </div>
        <div className="leg-item">
          <div className="leg-dot" style={{ background: 'rgba(245,158,11,0.15)', border: '1px dashed #f59e0b' }} /> RSU Coverage Zone
        </div>
        <div className="topo-channel-note">
          802.11p · 5.9 GHz · 16 dBm · Log-normal shadowing σ=8dB · Sensitivity −80 dBm
        </div>
      </div>
    </div>
  )
}
