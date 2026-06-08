import asyncio
import json
import subprocess
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

NS3_DIR = Path.home() / "ns-3-dev"
NS3_BIN = NS3_DIR / "ns3"
SIM_TARGET = "scratch/vanet-sim/vanet-sim"

app = FastAPI(title="VANET Simulation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class SimConfig(BaseModel):
    n_vehicles: Annotated[int, Field(ge=2, le=100)] = 10
    n_rsus: Annotated[int, Field(ge=1, le=20)] = 3
    sim_time: Annotated[float, Field(ge=10.0, le=300.0)] = 60.0
    vehicle_speed: Annotated[float, Field(ge=1.0, le=60.0)] = 20.0
    rsu_range: Annotated[float, Field(ge=50.0, le=1000.0)] = 200.0
    area_width: Annotated[float, Field(ge=200.0, le=5000.0)] = 1000.0
    area_height: Annotated[float, Field(ge=200.0, le=5000.0)] = 500.0

    @field_validator("n_rsus")
    @classmethod
    def rsus_less_than_vehicles(cls, v, info):
        if "n_vehicles" in info.data and v >= info.data["n_vehicles"]:
            raise ValueError("n_rsus must be less than n_vehicles")
        return v


def build_ns3_args(cfg: SimConfig) -> list[str]:
    return [
        str(NS3_BIN), "run", SIM_TARGET,
        "--",
        f"--nVehicles={cfg.n_vehicles}",
        f"--nRSUs={cfg.n_rsus}",
        f"--simTime={cfg.sim_time}",
        f"--vehicleSpeed={cfg.vehicle_speed}",
        f"--rsuRange={cfg.rsu_range}",
        f"--areaWidth={cfg.area_width}",
        f"--areaHeight={cfg.area_height}",
    ]


class SimState:
    def __init__(self):
        self.metrics: dict = {
            "registration_latency_ms": [],
            "auth_latency_ms": [],
            "key_exchange_latency_ms": [],
            "rsu_load": [],
            "total_collisions": 0,
            "total_handoffs": 0,
            "successful_handoffs": 0,
            "failed_handoffs": 0,
        }
        self.vehicles: dict = {}
        self.rsus: dict = {}
        self.registered: int = 0
        self.authenticated: int = 0
        self.keys_exchanged: int = 0
        self.msg_counts: dict = {}

    def process(self, event: dict) -> None:
        t = event.get("event")

        if t == "METRIC":
            name = event.get("metric")
            val = event.get("value", 0)
            if name in self.metrics and isinstance(self.metrics[name], list):
                self.metrics[name].append(val)

        elif t == "POSITION":
            node_id = event.get("node_id")
            role = event.get("role")
            if role == "vehicle":
                self.vehicles[node_id] = {"x": event["x"], "y": event["y"]}
            elif role == "rsu":
                self.rsus[node_id] = {"x": event["x"], "y": event["y"]}

        elif t == "HANDOFF":
            self.metrics["total_handoffs"] += 1
            if event.get("success"):
                self.metrics["successful_handoffs"] += 1
            else:
                self.metrics["failed_handoffs"] += 1

        elif t == "COLLISION":
            self.metrics["total_collisions"] += 1

        elif t == "MSG_SENT":
            msg_type = event.get("msg_type", "UNKNOWN")
            self.msg_counts[msg_type] = self.msg_counts.get(msg_type, 0) + 1

        elif t == "SIM_SUMMARY":
            self.registered = event.get("registered", 0)
            self.authenticated = event.get("authenticated", 0)
            self.keys_exchanged = event.get("keys_exchanged", 0)

    def summary(self) -> dict:
        def avg(lst): return sum(lst) / len(lst) if lst else 0.0
        return {
            "avg_registration_latency_ms": avg(self.metrics["registration_latency_ms"]),
            "avg_auth_latency_ms": avg(self.metrics["auth_latency_ms"]),
            "avg_key_exchange_latency_ms": avg(self.metrics["key_exchange_latency_ms"]),
            "avg_rsu_load": avg(self.metrics["rsu_load"]),
            "total_collisions": self.metrics["total_collisions"],
            "total_handoffs": self.metrics["total_handoffs"],
            "successful_handoffs": self.metrics["successful_handoffs"],
            "failed_handoffs": self.metrics["failed_handoffs"],
            "registered": self.registered,
            "authenticated": self.authenticated,
            "keys_exchanged": self.keys_exchanged,
            "msg_counts": self.msg_counts,
        }


@app.get("/health")
def health():
    return {"status": "ok", "ns3_dir": str(NS3_DIR), "ns3_exists": NS3_BIN.exists()}


@app.post("/validate")
def validate_config(cfg: SimConfig):
    return {"valid": True, "config": cfg.model_dump()}


@app.websocket("/simulate")
async def simulate(websocket: WebSocket):
    await websocket.accept()

    try:
        raw = await websocket.receive_text()
        cfg = SimConfig.model_validate_json(raw)
    except Exception as e:
        await websocket.send_text(json.dumps({"event": "ERROR", "msg": str(e)}))
        await websocket.close()
        return

    args = build_ns3_args(cfg)
    state = SimState()

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=str(NS3_DIR),
        )
    except Exception as e:
        await websocket.send_text(json.dumps({"event": "ERROR", "msg": f"Failed to start NS3: {e}"}))
        await websocket.close()
        return

    await websocket.send_text(json.dumps({"event": "SIM_STARTED"}))

    try:
        async for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            state.process(event)
            await websocket.send_text(json.dumps(event))

        await proc.wait()
        summary = state.summary()
        await websocket.send_text(json.dumps({"event": "SIM_COMPLETE", **summary}))

    except WebSocketDisconnect:
        proc.kill()
        await proc.wait()
    except Exception as e:
        await websocket.send_text(json.dumps({"event": "ERROR", "msg": str(e)}))
        proc.kill()
        await proc.wait()
    finally:
        await websocket.close()
