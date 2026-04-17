"""
IARIS Process Monitor — Cross-Platform Process Discovery & Metrics Collection

Uses psutil to sample all running processes at configurable intervals.
Handles race conditions (NoSuchProcess, AccessDenied, ZombieProcess) gracefully.
Works identically on Windows and Linux/WSL.
"""

from __future__ import annotations

import asyncio
import logging
import platform
import time
from typing import Callable, Optional

import psutil

from iaris.models import (
    IARISConfig,
    ProcessMetrics,
    SystemSnapshot,
    SystemState,
    SystemBehavior,
)

logger = logging.getLogger("iaris.monitor")


class ProcessMonitor:
    """
    Cross-platform process monitor using psutil.

    Samples all running processes at a configurable interval and produces
    ProcessMetrics snapshots. Also tracks system-wide resource usage.
    """

    def __init__(self, config: Optional[IARISConfig] = None):
        self.config = config or IARISConfig()
        self._running = False
        self._process_cache: dict[int, ProcessMetrics] = {}
        self._prev_io: dict[int, tuple[int, int, float]] = {}  # pid -> (read, write, timestamp)
        self._prev_disk_io: Optional[tuple] = None
        self._prev_net_io: Optional[tuple] = None
        self._prev_time: float = time.time()
        self._callbacks: list[Callable] = []
        self._system_snapshot = SystemSnapshot()
        self._platform = platform.system()  # 'Windows' or 'Linux'

        # Initialize CPU percent (first call always returns 0)
        psutil.cpu_percent(interval=None)

    @property
    def processes(self) -> dict[int, ProcessMetrics]:
        """Current process metrics cache."""
        return self._process_cache.copy()

    @property
    def system(self) -> SystemSnapshot:
        """Current system snapshot."""
        return self._system_snapshot

    def on_update(self, callback: Callable) -> None:
        """Register a callback for when metrics are updated."""
        self._callbacks.append(callback)

    def _collect_system_metrics(self) -> SystemSnapshot:
        """Collect system-wide resource metrics."""
        now = time.time()
        dt = now - self._prev_time

        # CPU
        cpu_percent = psutil.cpu_percent(interval=None)
        cpu_count = psutil.cpu_count() or 1

        # Memory
        mem = psutil.virtual_memory()
        mem_percent = mem.percent
        mem_total_gb = mem.total / (1024 ** 3)
        mem_available_gb = mem.available / (1024 ** 3)

        # Disk usage
        disk_percent = 0.0
        try:
            disk_path = "C:\\" if self._platform == "Windows" else "/"
            disk_percent = psutil.disk_usage(disk_path).percent
        except Exception:
            pass

        # Disk I/O rates
        disk_read_rate = 0.0
        disk_write_rate = 0.0
        try:
            disk_io = psutil.disk_io_counters()
            if disk_io and self._prev_disk_io and dt > 0:
                disk_read_rate = (disk_io.read_bytes - self._prev_disk_io[0]) / dt
                disk_write_rate = (disk_io.write_bytes - self._prev_disk_io[1]) / dt
            if disk_io:
                self._prev_disk_io = (disk_io.read_bytes, disk_io.write_bytes)
        except Exception:
            pass

        # Network I/O rates
        net_send_rate = 0.0
        net_recv_rate = 0.0
        try:
            net_io = psutil.net_io_counters()
            if net_io and self._prev_net_io and dt > 0:
                net_send_rate = (net_io.bytes_sent - self._prev_net_io[0]) / dt
                net_recv_rate = (net_io.bytes_recv - self._prev_net_io[1]) / dt
            if net_io:
                self._prev_net_io = (net_io.bytes_sent, net_io.bytes_recv)
        except Exception:
            pass

        self._prev_time = now

        # Determine system state
        state = SystemState.STABLE
        if (cpu_percent >= self.config.critical_cpu_threshold or
                mem_percent >= self.config.critical_memory_threshold):
            state = SystemState.CRITICAL
        elif (cpu_percent >= self.config.pressure_cpu_threshold or
              mem_percent >= self.config.pressure_memory_threshold):
            state = SystemState.PRESSURE

        behavior = {
            SystemState.STABLE: SystemBehavior.BALANCED,
            SystemState.PRESSURE: SystemBehavior.PROTECTIVE,
            SystemState.CRITICAL: SystemBehavior.AGGRESSIVE,
        }[state]

        snapshot = SystemSnapshot(
            cpu_percent=cpu_percent,
            cpu_count=cpu_count,
            memory_percent=mem_percent,
            disk_percent=disk_percent,
            memory_total_gb=round(mem_total_gb, 2),
            memory_available_gb=round(mem_available_gb, 2),
            disk_io_read_rate=disk_read_rate,
            disk_io_write_rate=disk_write_rate,
            net_io_send_rate=net_send_rate,
            net_io_recv_rate=net_recv_rate,
            process_count=0,  # Updated after process scan
            state=state,
            behavior=behavior,
            timestamp=now,
        )
        return snapshot

    def _collect_process_metrics(self) -> dict[int, ProcessMetrics]:
        """Collect metrics for all running processes."""
        now = time.time()
        new_cache: dict[int, ProcessMetrics] = {}
        attrs = [
            "pid", "name", "cpu_percent", "memory_percent",
            "memory_info", "io_counters", "num_threads",
            "status", "create_time", "username",
        ]

        for proc in psutil.process_iter(attrs=attrs):
            try:
                info = proc.info
                pid = info["pid"]
                name = info.get("name", "") or ""

                # Calculate I/O rates
                io_read_rate = 0.0
                io_write_rate = 0.0
                io_read = 0
                io_write = 0

                io_counters = info.get("io_counters")
                if io_counters:
                    io_read = io_counters.read_bytes
                    io_write = io_counters.write_bytes
                    if pid in self._prev_io:
                        prev_read, prev_write, prev_ts = self._prev_io[pid]
                        dt = now - prev_ts
                        if dt > 0:
                            io_read_rate = (io_read - prev_read) / dt
                            io_write_rate = (io_write - prev_write) / dt
                    self._prev_io[pid] = (io_read, io_write, now)

                mem_info = info.get("memory_info")
                mem_rss_mb = (mem_info.rss / (1024 * 1024)) if mem_info else 0.0

                metrics = ProcessMetrics(
                    pid=pid,
                    name=name,
                    cpu_percent=info.get("cpu_percent", 0.0) or 0.0,
                    memory_percent=info.get("memory_percent", 0.0) or 0.0,
                    memory_rss_mb=round(mem_rss_mb, 2),
                    io_read_bytes=io_read,
                    io_write_bytes=io_write,
                    io_read_rate=io_read_rate,
                    io_write_rate=io_write_rate,
                    num_threads=info.get("num_threads", 0) or 0,
                    status=info.get("status", "running") or "running",
                    create_time=info.get("create_time", 0.0) or 0.0,
                    username=info.get("username", "") or "",
                    timestamp=now,
                )
                new_cache[pid] = metrics

            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                # Process disappeared or we can't access it — skip gracefully
                continue
            except Exception as e:
                logger.debug(f"Error collecting metrics for process: {e}")
                continue

        # Clean up stale I/O tracking
        active_pids = set(new_cache.keys())
        stale_pids = set(self._prev_io.keys()) - active_pids
        for pid in stale_pids:
            del self._prev_io[pid]

        return new_cache

    def sample_once(self) -> tuple[SystemSnapshot, dict[int, ProcessMetrics]]:
        """Perform a single sampling pass. Returns (system_snapshot, process_metrics)."""
        system = self._collect_system_metrics()
        processes = self._collect_process_metrics()
        system.process_count = len(processes)

        self._system_snapshot = system
        self._process_cache = processes

        return system, processes

    async def start(self) -> None:
        """Start the continuous monitoring loop."""
        self._running = True
        logger.info(
            f"IARIS Monitor started on {self._platform} "
            f"(interval={self.config.sample_interval}s)"
        )

        while self._running:
            start_time = time.time()

            system, processes = self.sample_once()

            # Yield to event loop after heavy synchronous work
            # so uvicorn can handle HTTP/WebSocket requests
            await asyncio.sleep(0.1)

            # Notify all callbacks
            for callback in self._callbacks:
                try:
                    result = callback(system, processes)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    logger.error(f"Callback error: {e}")

            # Sleep for remaining interval
            elapsed = time.time() - start_time
            sleep_time = max(0, self.config.sample_interval - elapsed)
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    def stop(self) -> None:
        """Stop the monitoring loop."""
        self._running = False
        logger.info("IARIS Monitor stopped")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.stop()
