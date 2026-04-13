"""
IARIS EWMA Continuity System — Learning Delay Solution

Addresses the learning delay problem by ensuring EWMA learning never resets,
achieving convergence in ~30-90 seconds instead of minutes.

Key Components:
  1. EWMA History Preservation — keep learning state in cache
  2. Convergence Tracking — monitor learning progress phases
  3. Continuity Enforcement — ensure incremental refinement
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from iaris.models import BehaviorProfile, BehaviorType

logger = logging.getLogger("iaris.continuity")


class ConvergencePhase(str, Enum):
    """Learning phases during process lifecycle."""
    BOOTSTRAP = "bootstrap"      # 0-10s: similarity-based initialization
    ADAPTATION = "adaptation"    # 10-90s: EWMA refinement
    STABLE = "stable"            # >90s: consistent, learned behavior


@dataclass
class EWMAState:
    """Preserves EWMA state for continuity."""
    
    # EWMA values
    avg_cpu: float = 0.0
    avg_memory: float = 0.0
    avg_io_rate: float = 0.0
    burstiness: float = 0.0
    blocking_ratio: float = 0.0
    
    # Criticality and sensitivity (learned attributes)
    criticality: float = 0.5
    latency_sensitivity: float = 0.5
    allocation_score: float = 0.5
    
    # Learning metadata
    observation_count: int = 0
    created_at: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)
    
    @property
    def age_seconds(self) -> float:
        """Time since this state was created."""
        return time.time() - self.created_at
    
    @property
    def convergence_phase(self) -> ConvergencePhase:
        """Determine current learning phase based on age."""
        age = self.age_seconds
        if age < 10:
            return ConvergencePhase.BOOTSTRAP
        elif age < 90:
            return ConvergencePhase.ADAPTATION
        else:
            return ConvergencePhase.STABLE
    
    @property
    def convergence_progress(self) -> float:
        """
        Progress toward convergence as percentage [0.0, 1.0].
        
        Bootstrap: 0-30% (0-10s)
        Adaptation: 30-95% (10-90s)
        Stable: 95-100% (90s+)
        """
        age = self.age_seconds
        if age < 10:
            return 0.3 * (age / 10.0)
        elif age < 90:
            return 0.3 + 0.65 * ((age - 10) / 80.0)
        else:
            return 1.0


@dataclass
class ContinuityMetrics:
    """Metrics tracking learning continuity and convergence."""
    
    # EWMA parameters
    ewma_alpha_warmup: float = 0.3  # Higher for faster learning in bootstrap
    ewma_alpha_steady: float = 0.1  # Lower for stability once converged
    
    # Continuity thresholds
    max_score_velocity: float = 0.2  # Max acceptable change per sample
    min_observations_for_spike: int = 5  # Samples before trusting a value
    
    # Convergence detection
    stability_window: int = 20  # Samples to check for stability
    stability_threshold: float = 0.05  # Max variance for convergence


class EWMAContinuityEngine:
    """
    Manages EWMA learning continuity.
    
    Ensures:
      - Learning never resets (history preserved in observations)
      - Incremental refinement (no jumps in values)
      - Fast convergence (~30-90 seconds)
      - Smooth transitions between phases
    """
    
    def __init__(self, metrics: Optional[ContinuityMetrics] = None):
        self.metrics = metrics or ContinuityMetrics()
        self._ewma_history: dict[int, list[EWMAState]] = {}  # pid -> list of states
        self._spike_detectors: dict[int, list[float]] = {}  # pid -> value history for spike detection
    
    def preserve_state(self, profile: BehaviorProfile) -> EWMAState:
        """
        Capture current EWMA state for preservation.
        
        This state will be used to ensure continuity across computations.
        """
        state = EWMAState(
            avg_cpu=profile.avg_cpu,
            avg_memory=profile.avg_memory,
            avg_io_rate=profile.avg_io_rate,
            burstiness=profile.burstiness,
            blocking_ratio=profile.blocking_ratio,
            criticality=profile.criticality,
            latency_sensitivity=profile.latency_sensitivity,
            allocation_score=profile.allocation_score,
            observation_count=profile.observation_count,
        )
        
        # Store in history
        if profile.pid not in self._ewma_history:
            self._ewma_history[profile.pid] = []
        
        self._ewma_history[profile.pid].append(state)
        
        # Keep only recent history (last 100 observations)
        if len(self._ewma_history[profile.pid]) > 100:
            self._ewma_history[profile.pid].pop(0)
        
        return state
    
    def get_latest_state(self, pid: int) -> Optional[EWMAState]:
        """Get the most recent EWMA state for a process."""
        history = self._ewma_history.get(pid, [])
        return history[-1] if history else None
    
    def compute_ewma_with_continuity(
        self,
        profile: BehaviorProfile,
        new_observation: float,
        state_type: str = "cpu",  # "cpu", "memory", "io", "score", etc.
    ) -> float:
        """
        Compute EWMA value with continuity constraints.
        
        Detects and smooths spikes to prevent jerky learning.
        
        Args:
          - profile: current behavior profile
          - new_observation: raw new value
          - state_type: which metric to update
        
        Returns:
          - EWMA value after applying continuity constraints
        """
        pid = profile.pid
        
        # Get convergence phase
        latest = self.get_latest_state(pid)
        phase = latest.convergence_phase if latest else ConvergencePhase.BOOTSTRAP
        
        # Select alpha based on phase
        if phase == ConvergencePhase.BOOTSTRAP:
            alpha = self.metrics.ewma_alpha_warmup  # Fast learning
        elif phase == ConvergencePhase.ADAPTATION:
            # Gradually reduce alpha as we adapt
            progress = latest.convergence_progress if latest else 0.5
            alpha = self.metrics.ewma_alpha_warmup * (1.0 - progress) + self.metrics.ewma_alpha_steady * progress
        else:  # STABLE
            alpha = self.metrics.ewma_alpha_steady  # Slow, stable updates
        
        # Get current EWMA value
        current_value = getattr(profile, f'avg_{state_type}', 0.5) if state_type != "score" else profile.allocation_score
        
        # Detect and handle spikes
        if self._is_spike(pid, new_observation, state_type):
            logger.debug(f"Spike detected in {pid} {state_type}: {current_value:.2f} -> {new_observation:.2f}")
            # Use smaller alpha for suspected spikes (smooth it out)
            alpha = alpha * 0.5
        
        # Apply EWMA with continuity
        new_ewma = alpha * new_observation + (1.0 - alpha) * current_value
        
        # Enforce max velocity constraint
        max_change = self.metrics.max_score_velocity
        if abs(new_ewma - current_value) > max_change:
            # Constrain change to max velocity
            direction = 1.0 if new_ewma > current_value else -1.0
            new_ewma = current_value + (direction * max_change)
            logger.debug(f"Velocity constrained: {pid} {state_type} change limited to {max_change:.3f}")
        
        return new_ewma
    
    def _is_spike(self, pid: int, value: float, state_type: str) -> bool:
        """
        Detect if a value is an anomalous spike.
        
        Uses statistical approach: if value deviates significantly from recent history,
        it's likely a spike.
        """
        key = f"{pid}_{state_type}"
        history = self._spike_detectors.get(key, [])
        
        # Need history to detect spikes
        if len(history) < self.metrics.min_observations_for_spike:
            history.append(value)
            self._spike_detectors[key] = history
            return False
        
        # Maintain rolling window
        history.append(value)
        if len(history) > 30:
            history.pop(0)
        self._spike_detectors[key] = history
        
        # Compute statistics
        mean = sum(history[:-1]) / len(history[:-1])  # Exclude current
        variance = sum((x - mean) ** 2 for x in history[:-1]) / len(history[:-1])
        std_dev = variance ** 0.5
        
        # Spike if value is > 2 std devs from mean
        if std_dev > 0 and abs(value - mean) > 2 * std_dev:
            return True
        
        return False
    
    def is_converged(self, pid: int) -> bool:
        """
        Check if a process has converged to stable behavior.
        
        Uses variance of recent observations.
        """
        key = f"{pid}_convergence"
        history = self._spike_detectors.get(key, [])
        
        if len(history) < self.metrics.stability_window:
            return False
        
        # Get recent window
        recent = history[-self.metrics.stability_window:]
        
        # Compute variance
        mean = sum(recent) / len(recent)
        variance = sum((x - mean) ** 2 for x in recent) / len(recent)
        
        # Converged if variance is low
        return variance < self.metrics.stability_threshold
    
    def get_convergence_info(self, pid: int) -> dict:
        """
        Get detailed convergence information for a process.
        
        Returns dict with:
          - phase: current ConvergencePhase
          - progress: convergence progress [0-1]
          - age_seconds: time since first observation
          - observations: number of observations
          - is_converged: boolean
        """
        latest = self.get_latest_state(pid)
        
        if not latest:
            return {
                'phase': ConvergencePhase.BOOTSTRAP.value,
                'progress': 0.0,
                'age_seconds': 0.0,
                'observations': 0,
                'is_converged': False,
            }
        
        return {
            'phase': latest.convergence_phase.value,
            'progress': latest.convergence_progress,
            'age_seconds': latest.age_seconds,
            'observations': latest.observation_count,
            'is_converged': self.is_converged(pid),
        }
    
    def cleanup(self, active_pids: set[int]) -> None:
        """Remove history for dead processes."""
        dead_pids = set(self._ewma_history.keys()) - active_pids
        for pid in dead_pids:
            del self._ewma_history[pid]
            # Also clean spike detectors
            keys_to_remove = [k for k in self._spike_detectors.keys() if k.startswith(f"{pid}_")]
            for k in keys_to_remove:
                del self._spike_detectors[k]


class LearningAccelerator:
    """
    End-to-end learning acceleration.
    
    Combines EWMA continuity with bootstrap to achieve fast convergence
    from cold start to stable (~30-90 seconds).
    """
    
    def __init__(self):
        self.continuity = EWMAContinuityEngine()
    
    def apply_continuity_update(
        self,
        profile: BehaviorProfile,
        new_metrics: dict,  # {'cpu': value, 'memory': value, ...}
    ) -> BehaviorProfile:
        """
        Apply continuity-aware EWMA updates to a profile.
        
        Ensures smooth, incremental learning without resets.
        """
        # Preserve current state
        self.continuity.preserve_state(profile)
        
        # Apply continuity-constrained EWMA to each metric
        for metric_name, metric_value in new_metrics.items():
            # Skip invalid values
            if metric_value is None or metric_value < 0:
                continue
            
            # Get EWMA with continuity
            new_ewma = self.continuity.compute_ewma_with_continuity(
                profile,
                metric_value,
                metric_name,
            )
            
            # Update profile
            if metric_name == "cpu":
                profile.avg_cpu = new_ewma
            elif metric_name == "memory":
                profile.avg_memory = new_ewma
            elif metric_name == "io":
                profile.avg_io_rate = new_ewma
            elif metric_name == "score":
                profile.allocation_score = new_ewma
        
        return profile
    
    def get_learning_status(self, pid: int) -> dict:
        """Get learning status and convergence information."""
        return self.continuity.get_convergence_info(pid)
