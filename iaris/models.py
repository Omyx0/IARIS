"""
IARIS Core Engine — Models and Data Structures

Defines the core data types used across all IARIS layers.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─── Behavior Types ───────────────────────────────────────────────────────────

class BehaviorType(str, Enum):
    """Process behavior classification types."""
    CPU_HOG = "cpu_hog"
    LATENCY_SENSITIVE = "latency_sensitive"
    BURSTY = "bursty"
    BLOCKING = "blocking"
    MEMORY_HEAVY = "memory_heavy"
    IDLE = "idle"
    UNKNOWN = "unknown"


class SystemState(str, Enum):
    """Overall system health states."""
    STABLE = "stable"
    PRESSURE = "pressure"
    CRITICAL = "critical"


class AllocationAction(str, Enum):
    """Resource allocation decisions."""
    BOOST = "boost"
    MAINTAIN = "maintain"
    THROTTLE = "throttle"
    PAUSE = "pause"


class SystemBehavior(str, Enum):
    """System-wide behavioral response mode."""
    BALANCED = "balanced"       # Stable state — fair allocation
    PROTECTIVE = "protective"   # Pressure state — protect critical processes
    AGGRESSIVE = "aggressive"   # Critical state — aggressive throttling


# ─── Process Metrics ──────────────────────────────────────────────────────────

@dataclass
class ProcessMetrics:
    """Snapshot of a single process's resource usage."""
    pid: int
    name: str
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    memory_rss_mb: float = 0.0
    io_read_bytes: int = 0
    io_write_bytes: int = 0
    io_read_rate: float = 0.0   # bytes/sec
    io_write_rate: float = 0.0  # bytes/sec
    num_threads: int = 0
    status: str = "running"
    create_time: float = 0.0
    username: str = ""
    timestamp: float = field(default_factory=time.time)

    @property
    def age_seconds(self) -> float:
        """How long this process has been running."""
        return time.time() - self.create_time if self.create_time > 0 else 0.0


# ─── Behavior Profile ────────────────────────────────────────────────────────

@dataclass
class BehaviorProfile:
    """EWMA-smoothed behavior profile for a process."""
    pid: int
    name: str
    behavior_type: BehaviorType = BehaviorType.UNKNOWN
    signature: str = ""

    # EWMA-smoothed metrics
    avg_cpu: float = 0.0
    avg_memory: float = 0.0
    avg_io_rate: float = 0.0
    burstiness: float = 0.0       # Variance in CPU usage
    blocking_ratio: float = 0.0   # Time spent in waiting states

    # Scoring
    criticality: float = 0.5      # How important is this process (0-1)
    latency_sensitivity: float = 0.5  # How sensitive to delays (0-1)
    allocation_score: float = 0.5 # Final allocation score (0-1)

    # Learning metadata
    observation_count: int = 0
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    
    # Cold Start Bootstrap (similarity matching)
    bootstrapped: bool = False        # Whether profile was bootstrapped from similar process
    bootstrap_confidence: float = 0.0 # Confidence of bootstrap (0-1)
    bootstrap_source: str = ""        # Name of process used for bootstrap
    
    # Learning Continuity (EWMA)
    learning_phase: str = "bootstrap" # "bootstrap", "adaptation", "stable"
    convergence_progress: float = 0.0 # Learning progress (0-1)

    def generate_signature(self) -> str:
        """Generate a behavior signature hash."""
        sig_input = f"{self.name}:{self.behavior_type.value}:{self.avg_cpu:.0f}:{self.avg_memory:.0f}"
        self.signature = hashlib.md5(sig_input.encode()).hexdigest()[:12]
        return self.signature


# ─── System Snapshot ─────────────────────────────────────────────────────────

@dataclass
class SystemSnapshot:
    """Point-in-time snapshot of overall system state."""
    cpu_percent: float = 0.0
    cpu_count: int = 1
    memory_percent: float = 0.0
    disk_percent: float = 0.0
    memory_total_gb: float = 0.0
    memory_available_gb: float = 0.0
    disk_io_read_rate: float = 0.0
    disk_io_write_rate: float = 0.0
    net_io_send_rate: float = 0.0
    net_io_recv_rate: float = 0.0
    process_count: int = 0
    state: SystemState = SystemState.STABLE
    behavior: SystemBehavior = SystemBehavior.BALANCED
    timestamp: float = field(default_factory=time.time)


# ─── Allocation Decision ─────────────────────────────────────────────────────

@dataclass
class AllocationDecision:
    """A resource allocation decision with reasoning."""
    pid: int
    process_name: str
    action: AllocationAction
    score: float
    reason: str                        # Natural language explanation
    system_state: SystemState
    behavior_type: BehaviorType
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "pid": self.pid,
            "process_name": self.process_name,
            "action": self.action.value,
            "score": round(self.score, 3),
            "reason": self.reason,
            "system_state": self.system_state.value,
            "behavior_type": self.behavior_type.value,
            "timestamp": self.timestamp,
        }


# ─── Workload Group ──────────────────────────────────────────────────────────

@dataclass
class WorkloadGroup:
    """A logical grouping of related processes."""
    name: str
    description: str = ""
    process_patterns: list[str] = field(default_factory=list)  # Name patterns to match
    priority: float = 0.5                                       # Group priority (0-1)
    member_pids: list[int] = field(default_factory=list)
    total_cpu: float = 0.0
    total_memory: float = 0.0

    def matches_process(self, process_name: str) -> bool:
        """Check if a process name matches any pattern in this group."""
        name_lower = process_name.lower()
        return any(pattern.lower() in name_lower for pattern in self.process_patterns)


# ─── Configuration ───────────────────────────────────────────────────────────

@dataclass
class IARISConfig:
    """System configuration with tunable thresholds."""
    # Sampling
    sample_interval: float = 1.0       # seconds between samples

    # EWMA
    ewma_alpha: float = 0.3            # Learning rate (0.3 = 30% new, 70% old)
    ewma_warmup_alpha: float = 0.5     # Higher alpha during warmup
    warmup_observations: int = 10      # Observations before switching to normal alpha

    # System state thresholds
    pressure_cpu_threshold: float = 70.0    # CPU% to enter Pressure
    critical_cpu_threshold: float = 90.0    # CPU% to enter Critical
    pressure_memory_threshold: float = 75.0 # Memory% to enter Pressure
    critical_memory_threshold: float = 90.0 # Memory% to enter Critical

    # Behavior classification thresholds
    cpu_hog_threshold: float = 50.0         # CPU% sustained to be "cpu_hog"
    bursty_variance_threshold: float = 20.0 # CPU variance to be "bursty"
    blocking_ratio_threshold: float = 0.3   # Blocking ratio to be "blocking"
    memory_heavy_threshold: float = 10.0    # Memory% to be "memory_heavy"
    idle_cpu_threshold: float = 2.0         # CPU% below to be "idle"

    # Allocation score weights
    weight_behavior: float = 0.4
    weight_system_state: float = 0.3
    weight_workload: float = 0.3
