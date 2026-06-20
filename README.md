# VANET Simulation Monitor

A real-time network simulation web app for analyzing the efficiency of the **BBAAS** (Blockchain-Based Anonymous Authentication Scheme) protocol in Vehicular Ad-hoc Networks (VANETs), based on Maria et al.'s research on blockchain authentication for VANETs.

This is a **network-side simulation only** — no cryptographic operations, no attack scenarios. The goal is to measure and visualize protocol efficiency: registration latency, authentication latency, key exchange latency, handoff behavior, end-to-end delay, throughput, and message loss ratio under realistic 802.11p wireless channel conditions.

## Architecture

```
Browser (React + TypeScript + Vite)
    ↕ WebSocket (live event streaming) + REST (health/validation)
FastAPI Backend (Python, runs in WSL2)
    ↕ subprocess stdout streaming (real-time JSON events)
NS-3.42 Simulation (C++, runs in WSL2)
```

- **NS-3** simulates vehicle mobility, 802.11p wireless transmission, RSU placement, and per-packet PHY-layer behavior — streaming structured JSON events to stdout in real time.
- **FastAPI** consumes the NS-3 stream via subprocess, runs the protocol state machine, aggregates metrics, and exposes everything over a WebSocket to the frontend.
- **React frontend** renders a live animated highway topology, a metrics dashboard, an event log, and a multi-run comparison tool.

## Stack

| Layer | Technology |
|---|---|
| Simulation | NS-3.42 (C++), WSL2 Ubuntu 22.04 |
| Backend | FastAPI, Python 3.10, WSL2 |
| Frontend | React 18, TypeScript, Vite 5, D3.js, Recharts |
| Styling | Custom CSS — mixed IDE theme (light panels on dark navy) |

## Repository Structure

```
vanet-sim/
├── ns3/
│   └── vanet-sim.cc          # NS-3 simulation script (copy into ~/ns-3-dev/scratch/vanet-sim/)
├── backend/
│   ├── main.py                # FastAPI server
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ControlPanel.tsx
│   │   │   ├── TopologyMap.tsx
│   │   │   ├── MetricsDashboard.tsx
│   │   │   ├── ComparisonPanel.tsx
│   │   │   ├── LogPanel.tsx
│   │   │   └── Tooltip.tsx
│   │   ├── hooks/
│   │   │   ├── useSimulation.ts
│   │   │   ├── useComparison.ts
│   │   │   └── useLog.ts
│   │   ├── types/
│   │   │   ├── sim.ts
│   │   │   ├── comparison.ts
│   │   │   └── log.ts
│   │   └── index.css
│   └── index.html
└── README.md
```

## Simulation Model

### Protocol Phases
Each vehicle runs through three sequential phases against its nearest RSU and a central Trust Authority (TA):

1. **Registration** — Vehicle → RSU → TA → Vehicle (4-message round trip)
2. **Authentication** — Vehicle broadcasts a Session Initiation Message; RSU validates via a simulated smart contract delay and responds
3. **Key Exchange** — 3-message GIFT-algorithm key exchange, concluded with a confirmation message

### Wireless Channel Model
Packets are evaluated against a realistic 802.11p physical layer:

- **Frequency:** 5.9 GHz (DSRC band)
- **Tx power:** 16 dBm
- **Rx sensitivity:** −80 dBm
- **Path loss:** Friis free-space model
- **Shadowing:** Log-normal, σ = 8 dB (Box-Muller Gaussian)
- **Fading:** Rayleigh-like, ±3 dB
- **Retry policy:** Up to 3 attempts with exponential backoff (500ms / 1000ms / 2000ms) before a packet is marked permanently failed

This produces realistic, non-zero packet loss (typically 25–35% at default settings), enabling honest measurement of message loss ratio, throughput, and end-to-end delay — not just idealized latency numbers.

### Mobility Model
Vehicles move along a two-lane highway using `WaypointMobilityModel`:
- Even-indexed vehicles travel left-to-right in lane 1
- Odd-indexed vehicles travel right-to-left in lane 2
- Vehicles wrap around at road boundaries
- RSUs are fixed, evenly spaced along the road

### Default Parameters

| Parameter | Default | Description |
|---|---|---|
| Vehicles | 20 | Number of vehicles in simulation |
| RSUs | 2 | Roadside Units |
| RSU Range | 75 m | Coverage radius per RSU |
| Area | 2000m × 500m | Simulation area |
| Vehicle Speed | 40 m/s | Average vehicle speed |
| Sim Time | 60 s | Total simulation duration |

All parameters are configurable from the frontend control panel within validated bounds.

## Metrics

| Metric | Source | Description |
|---|---|---|
| Registration latency | NS-3, real | Full round-trip: vehicle → RSU → TA → vehicle |
| Authentication latency | NS-3, real | Session init + smart contract validation delay |
| Key exchange latency | NS-3, real | 3-step GIFT key exchange |
| End-to-end delay | NS-3, real | Full protocol sequence duration per vehicle |
| Throughput | NS-3, real | Total bytes successfully delivered ÷ elapsed time |
| Message loss ratio | NS-3, real | Dropped packets ÷ total attempted (802.11p PHY) |
| RSU load | Computed | Vehicles ÷ RSUs |
| Handoff count / success / fail | NS-3, real | RSU-to-RSU handoff tracking with 3s cooldown |
| Collisions / MAC retries | NS-3, real | PHY-layer trace callbacks (currently near-zero — see Known Limitations) |

## Features

- **Live topology map** — animated multi-lane highway with vehicles, RSU coverage zones, and handoff pulse effects (D3.js)
- **Metrics dashboard** — real-time charts for all latency phases, throughput, loss ratio, RSU load, and message distribution (Recharts)
- **Event log** — timestamped, filterable (Protocol / Errors & Warnings / All) log of every protocol message, with plain-English explanations for packet drops and retries
- **Run comparison** — save up to 5 completed simulation runs in-session, compare side-by-side via stat table and overlaid charts
- **Per-run log history** — each saved run retains its own event log, viewable from the Compare tab
- **Info tooltips** — every metric, parameter, and topology element has a hover tooltip explaining what it means
- **Fully responsive** — works on desktop, tablet, and mobile with adaptive layouts and touch-friendly controls

## Known Limitations

- **Collision / MAC retry metrics are near-zero.** The protocol logic runs as scheduled NS-3 events with real UDP-style packet evaluation against the channel model, but there is no competing background traffic generating true MAC-layer contention. PHY trace callbacks are wired and functional but rarely fire under current traffic patterns.
- **Packet sizes are estimates.** Byte sizes for each protocol message (e.g. 28B registration, 128B key confirmation) are derived from the BBAAS paper's communication cost analysis (measured in bits for cryptographic overhead), not from an explicit simulation specification in the paper. They are documented in `ns3/vanet-sim.cc` as reasonable estimates.
- **Blockchain and cryptographic operations are out of scope.** This simulation models network-layer behavior only — no actual ECC key generation, hashing, or blockchain transactions occur.
- **Attack scenarios are out of scope** (planned for a future iteration).

## Setup

### Prerequisites
- Windows 11 with WSL2 (Ubuntu 22.04)
- NS-3.42 installed in WSL2 at `~/ns-3-dev`
- Python 3.10+ with `pip`
- Node.js 18+ with `npm`

### 1. NS-3 Simulation
```bash
cp ns3/vanet-sim.cc ~/ns-3-dev/scratch/vanet-sim/vanet-sim.cc
cd ~/ns-3-dev
./ns3 build scratch/vanet-sim/vanet-sim
./ns3 run scratch/vanet-sim/vanet-sim   # sanity check
```

### 2. Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Verify at `http://localhost:8000/health`.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`.

The frontend connects to the backend via WebSocket at `ws://localhost:8000/simulate`. Both must be running for simulations to work.

## Deployment Notes

- **Frontend** is designed for static hosting (e.g. Vercel).
- **Backend** requires a host capable of running subprocesses and persistent WebSocket connections (a VPS, not a serverless platform) since it spawns the NS-3 binary directly.
- In production, the backend must be served over `wss://` (secure WebSocket) behind a reverse proxy with TLS, since browsers block mixed content when the frontend is served over HTTPS.

## License

Internal academic/research project. Not licensed for public redistribution.