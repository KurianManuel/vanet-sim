@"
# VANET Simulation Monitor

A real-time network simulation web app for VANET (Vehicular Ad hoc Network) authentication protocol efficiency analysis.

## Stack
- **Frontend**: React + TypeScript + Vite + D3 + Recharts
- **Backend**: FastAPI (Python, runs in WSL2)
- **Simulation**: NS-3.42 (C++, runs in WSL2)

## Structure
- `frontend/` — React app
- `backend/` — FastAPI server

## Setup
See docs for WSL2 + NS-3 installation steps.
"@ | Out-File -FilePath vanet-sim\README.md -Encoding utf8
