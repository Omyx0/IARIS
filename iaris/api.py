"""
IARIS API Server — FastAPI with REST + WebSocket

Exposes the IARIS engine via:
- REST endpoints for state, processes, workloads, decisions
- WebSocket for real-time streaming updates
- Control endpoints for dummy processes and configuration
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from iaris.engine import IARISEngine
from iaris.models import IARISConfig

logger = logging.getLogger("iaris.api")

# ─── Global engine instance ──────────────────────────────────────────────────
engine: Optional[IARISEngine] = None
engine_task: Optional[asyncio.Task] = None


# ─── Pydantic models ─────────────────────────────────────────────────────────

class SpawnRequest(BaseModel):
    behavior_type: str
    count: int = 1


class ThresholdUpdate(BaseModel):
    pressure_cpu: Optional[float] = None
    critical_cpu: Optional[float] = None
    pressure_memory: Optional[float] = None
    critical_memory: Optional[float] = None


class WorkloadConfig(BaseModel):
    name: str
    description: str = ""
    process_patterns: list[str] = []
    priority: float = 0.5


# ─── WebSocket Manager ───────────────────────────────────────────────────────

class ConnectionManager:
    """Manages WebSocket connections with heartbeat and cleanup."""

    def __init__(self):
        self.active: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self.active.append(ws)
        logger.info(f"WebSocket connected. Active: {len(self.active)}")

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self.active:
                self.active.remove(ws)
        logger.info(f"WebSocket disconnected. Active: {len(self.active)}")

    async def broadcast(self, data: dict) -> None:
        """Broadcast to all connected clients."""
        if not self.active:
            return

        message = json.dumps(data)
        dead: list[WebSocket] = []

        async with self._lock:
            for ws in self.active:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.append(ws)

            for ws in dead:
                self.active.remove(ws)


ws_manager = ConnectionManager()


# ─── App lifecycle ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start/stop the IARIS engine with the server."""
    global engine, engine_task

    engine = IARISEngine()

    # Register WebSocket broadcast on each tick
    async def broadcast_state(eng: IARISEngine):
        state = eng.get_state()
        await ws_manager.broadcast(state)

    engine.on_tick(broadcast_state)

    # Start engine in background with a small delay
    # so uvicorn can finish binding to the port first.
    # The engine's first tick does heavy synchronous work
    # (scanning hundreds of processes) which would starve
    # the event loop and block port binding.
    async def _delayed_engine_start():
        await asyncio.sleep(1.0)
        await engine.start()

    engine_task = asyncio.create_task(_delayed_engine_start())
    logger.info("IARIS API server started")

    yield

    # Cleanup
    if engine:
        engine.stop()
    if engine_task:
        engine_task.cancel()
        try:
            await engine_task
        except asyncio.CancelledError:
            pass
    logger.info("IARIS API server stopped")


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="IARIS API",
    description="Intent-Aware Adaptive Resource Intelligence System",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── REST Endpoints ──────────────────────────────────────────────────────────

@app.get("/api/state")
async def get_state():
    """Get complete system state."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return engine.get_state()





@app.get("/api/system")
async def get_system():
    """Get system-wide metrics."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    state = engine.get_state()
    return state["system"]


@app.get("/api/processes")
async def get_processes():
    """Get process list with behavior profiles."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    state = engine.get_state()
    return state["processes"]


@app.get("/api/workloads")
async def get_workloads():
    """Get workload group status."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return engine.workload.get_status()


@app.get("/api/decisions")
async def get_decisions(limit: int = 30):
    """Get recent allocation decisions."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    decisions = [d.to_dict() for d in list(engine.decisions)[-limit:]]
    return decisions


@app.get("/api/history")
async def get_history(limit: int = 300):
    """Get system metric history."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return engine.knowledge.get_system_history(limit)


# ─── Dummy Process Control ───────────────────────────────────────────────────

@app.get("/api/dummy")
async def get_dummy_status():
    """Get status of all dummy processes."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return engine.simulator.get_status()


@app.post("/api/dummy/spawn")
async def spawn_dummy(req: SpawnRequest):
    """Spawn dummy processes."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")

    if req.behavior_type not in engine.simulator.available_types:
        raise HTTPException(400, f"Invalid type. Available: {engine.simulator.available_types}")

    spawned = []
    for _ in range(min(req.count, 5)):  # Max 5 at once
        dummy = engine.simulator.spawn(req.behavior_type)
        if dummy and dummy.pid:
            spawned.append({"pid": dummy.pid, "type": req.behavior_type})

    return {"spawned": spawned}


@app.post("/api/dummy/spawn-demo")
async def spawn_demo_set():
    """Spawn one of each behavior type for demo."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")

    dummies = engine.simulator.spawn_demo_set()
    return {
        "spawned": [
            {"pid": d.pid, "type": d.behavior_type}
            for d in dummies if d.pid
        ]
    }


@app.delete("/api/dummy/{pid}")
async def stop_dummy(pid: int):
    """Stop a specific dummy process."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")

    success = engine.simulator.stop(pid)
    if not success:
        raise HTTPException(404, f"Dummy process {pid} not found")
    return {"stopped": pid}


@app.delete("/api/dummy")
async def stop_all_dummies():
    """Stop all dummy processes."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")

    count = engine.simulator.stop_all()
    return {"stopped_count": count}


# ─── Configuration ───────────────────────────────────────────────────────────

@app.put("/api/config/thresholds")
async def update_thresholds(update: ThresholdUpdate):
    """Update system state thresholds."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")

    if update.pressure_cpu is not None:
        engine.config.pressure_cpu_threshold = update.pressure_cpu
    if update.critical_cpu is not None:
        engine.config.critical_cpu_threshold = update.critical_cpu
    if update.pressure_memory is not None:
        engine.config.pressure_memory_threshold = update.pressure_memory
    if update.critical_memory is not None:
        engine.config.critical_memory_threshold = update.critical_memory

    return {"status": "updated", "thresholds": {
        "pressure_cpu": engine.config.pressure_cpu_threshold,
        "critical_cpu": engine.config.critical_cpu_threshold,
        "pressure_memory": engine.config.pressure_memory_threshold,
        "critical_memory": engine.config.critical_memory_threshold,
    }}


@app.get("/api/config")
async def get_config():
    """Get current IARIS configuration."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")

    cfg = engine.config
    return {
        "sample_interval": cfg.sample_interval,
        "ewma_alpha": cfg.ewma_alpha,
        "pressure_cpu_threshold": cfg.pressure_cpu_threshold,
        "critical_cpu_threshold": cfg.critical_cpu_threshold,
        "pressure_memory_threshold": cfg.pressure_memory_threshold,
        "critical_memory_threshold": cfg.critical_memory_threshold,
    }



# ─── Action Endpoints ─────────────────────────────────────────────────────────

class ActionRequest(BaseModel):
    pid: Optional[int] = None


@app.post("/api/action/throttle")
async def action_throttle(req: ActionRequest):
    """Mark a process intent for throttle (informational — engine decides autonomously)."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return {
        "status": "noted",
        "action": "throttle",
        "pid": req.pid,
        "note": "IARIS will apply throttle on next tick if conditions warrant.",
    }


@app.post("/api/action/maintain")
async def action_maintain(req: ActionRequest):
    """Mark a process intent for maintain."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return {
        "status": "noted",
        "action": "maintain",
        "pid": req.pid,
        "note": "IARIS will maintain allocation on next tick.",
    }


# ─── Simulation Aliases ───────────────────────────────────────────────────────

@app.post("/api/simulate/cpu")
async def simulate_cpu():
    """Spawn 3 cpu_hog dummy processes — stress CPU."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    spawned = []
    for _ in range(3):
        d = engine.simulator.spawn("cpu_hog")
        if d and d.pid:
            spawned.append({"pid": d.pid, "type": "cpu_hog"})
    return {"scenario": "CPU Load Simulation", "spawned": spawned}


@app.post("/api/simulate/memory")
async def simulate_memory():
    """Spawn 3 memory_heavy dummy processes — pressure memory."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    spawned = []
    for _ in range(3):
        d = engine.simulator.spawn("memory_heavy")
        if d and d.pid:
            spawned.append({"pid": d.pid, "type": "memory_heavy"})
    return {"scenario": "Memory Pressure Simulation", "spawned": spawned}


@app.post("/api/simulate/traffic")
async def simulate_traffic():
    """Spawn 3 latency_sensitive dummy processes — simulates web traffic."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    spawned = []
    for _ in range(3):
        d = engine.simulator.spawn("latency_sensitive")
        if d and d.pid:
            spawned.append({"pid": d.pid, "type": "latency_sensitive"})
    return {"scenario": "Web Traffic Simulation", "spawned": spawned}


@app.post("/api/reset")
async def reset_simulation():
    """Stop all dummy processes — clear simulation environment."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    count = engine.simulator.stop_all()
    return {"status": "cleared", "stopped_count": count}


# ─── Insights & Efficiency REST fallback ─────────────────────────────────────

@app.get("/api/insights")
async def get_insights():
    """Get latest insight list (REST fallback for clients not on WebSocket)."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return engine._insight_engine.generate(engine)


@app.get("/api/efficiency")
async def get_efficiency():
    """Get latest efficiency scores."""
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    return engine._insight_engine.compute_efficiency(engine)


# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """Real-time state streaming via WebSocket."""
    await ws_manager.connect(ws)
    try:
        while True:
            # Keep connection alive — listen for client messages
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=30)
                # Handle client commands if needed
                if data == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
            except asyncio.TimeoutError:
                # Send keepalive
                try:
                    await ws.send_text(json.dumps({"type": "keepalive"}))
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
    finally:
        await ws_manager.disconnect(ws)


# ─── Static file serving for React frontend ──────────────────────────────────

import os

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(FRONTEND_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/{path:path}")
    async def serve_frontend_fallback(path: str):
        file_path = os.path.join(FRONTEND_DIR, path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
