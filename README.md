# VANET Simulation Monitor

A real-time web-based simulator for evaluating the network efficiency of the **BBAAS (Blockchain-Based Anonymous Authentication Scheme)** protocol in **Vehicular Ad-hoc Networks (VANETs)**.

The project focuses on **network-side simulation** using NS-3 and does not implement actual cryptographic operations or attack scenarios. It measures protocol performance under realistic 802.11p wireless channel conditions.

## Architecture

```text
React + TypeScript + Vite
          │
     WebSocket / REST
          │
FastAPI Backend (Python)
          │
   NS-3.42 Simulation (C++)
```

* **NS-3.42** — Vehicle mobility, RSUs, 802.11p communication, packet evaluation, and wireless channel modeling.
* **FastAPI** — Runs the protocol state machine, processes simulation events, and streams results.
* **React + TypeScript** — Provides the interactive topology, metrics dashboard, event log, and run comparison.

## Technology Stack

| Component     | Technology                   |
| ------------- | ---------------------------- |
| Simulation    | NS-3.42, C++                 |
| Backend       | Python 3.10+, FastAPI        |
| Frontend      | React 18, TypeScript, Vite 5 |
| Visualization | D3.js, Recharts              |
| Environment   | Ubuntu 22.04 LTS, WSL2       |

## Simulation

The simulation models three protocol phases:

1. **Registration** — Vehicle, RSU, and Trust Authority interaction.
2. **Authentication** — Session initiation and simulated smart-contract validation.
3. **Key Exchange** — Three-message GIFT-based key exchange.

The wireless model includes:

* 5.9 GHz 802.11p communication
* Friis path loss
* Log-normal shadowing
* Rayleigh-like fading
* Packet retries and exponential backoff
* Two-lane vehicle mobility
* Fixed RSU deployment

### Default Parameters

| Parameter       |      Default |
| --------------- | -----------: |
| Vehicles        |           20 |
| RSUs            |            2 |
| RSU Range       |         75 m |
| Simulation Area | 2000 × 500 m |
| Vehicle Speed   |       40 m/s |
| Simulation Time |         60 s |

## Performance Metrics

The system measures:

* Registration latency
* Authentication latency
* Key exchange latency
* End-to-end delay
* Throughput
* Message loss ratio
* RSU load
* Handoff success/failure
* Packet collisions and MAC retries

## Features

* Real-time animated VANET topology
* Live performance metrics
* Protocol event logging
* Packet loss and retry visualization
* Multi-run comparison
* Per-run log history
* Responsive web interface
* Configurable simulation parameters

## Setup

### Prerequisites

* Windows 11 with WSL2
* Ubuntu 22.04 LTS
* NS-3.42
* Python 3.10+
* Node.js 18+
* npm

### 1. NS-3

```bash
cp ns3/vanet-sim.cc ~/ns-3-dev/scratch/vanet-sim/vanet-sim.cc
cd ~/ns-3-dev
./ns3 build scratch/vanet-sim/vanet-sim
./ns3 run scratch/vanet-sim/vanet-sim
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The frontend communicates with the FastAPI backend through WebSocket and REST APIs.

## Scope and Limitations

* Network-side simulation only; no actual blockchain transactions or cryptographic operations are performed.
* Attack scenarios are not currently implemented.
* Protocol message sizes are estimated from the referenced BBAAS research paper.
* MAC-layer collision and retry measurements may remain low because the simulation does not generate significant competing background traffic.

## Repository

GitHub: https://github.com/KurianManuel/vanet-sim

## License

Internal academic/research project. Not licensed for public redistribution.
