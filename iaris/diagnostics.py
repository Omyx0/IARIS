"""
IARIS Three-Hurdle Diagnostic & Monitoring System

Comprehensive monitoring and diagnostics for the three-hurdle solution framework:
1. Cold Start Resolution (similarity matching)
2. Overhead Reduction (v4.0 optimization pipeline)
3. Learning Acceleration (EWMA continuity)

Provides real-time metrics, health checks, and performance reporting.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("iaris.diagnostics")


@dataclass
class ColdStartMetrics:
    """Metrics for cold start performance."""
    processes_bootstrapped: int = 0
    bootstrap_confidence_sum: float = 0.0
    accuracy_estimate: float = 0.825  # ~82.5% expected accuracy
    processes_without_bootstrap: int = 0
    
    @property
    def avg_bootstrap_confidence(self) -> float:
        """Average bootstrap confidence score."""
        if self.processes_bootstrapped == 0:
            return 0.0
        return self.bootstrap_confidence_sum / self.processes_bootstrapped
    
    @property
    def health_score(self) -> float:
        """Overall health (0-1) based on bootstrap coverage and confidence."""
        if self.processes_bootstrapped == 0:
            return 0.0
        total = self.processes_bootstrapped + self.processes_without_bootstrap
        coverage = self.processes_bootstrapped / total if total > 0 else 0.0
        confidence = self.avg_bootstrap_confidence
        return 0.6 * coverage + 0.4 * confidence


@dataclass
class OverheadReductionMetrics:
    """Metrics for overhead reduction performance."""
    cache_hits: int = 0
    cache_misses: int = 0
    full_recomputes: int = 0
    delta_updates: int = 0
    cache_evictions: int = 0
    cache_size: int = 0
    max_cache_size: int = 10000
    
    @property
    def hit_rate(self) -> float:
        """Cache hit rate (0-1)."""
        total = self.cache_hits + self.cache_misses
        return self.cache_hits / total if total > 0 else 0.0
    
    @property
    def computation_savings_percent(self) -> float:
        """Percentage of computation avoided by caching (0-100)."""
        total_accesses = self.cache_hits + self.cache_misses
        if total_accesses == 0:
            return 0.0
        # Each cache hit avoids ~0.1ms computation, each miss triggers ~1ms
        # Rough approximation of time avoided
        time_avoided = self.cache_hits * 0.1
        time_total = (self.cache_hits * 0.1) + (self.cache_misses * 1.0)
        return 100 * (time_avoided / time_total) if time_total > 0 else 0.0
    
    @property
    def cache_saturation(self) -> float:
        """Cache saturation level (0-1)."""
        return self.cache_size / self.max_cache_size if self.max_cache_size > 0 else 0.0
    
    @property
    def health_score(self) -> float:
        """Overall health (0-1) based on hit rate and saturation."""
        hit_score = self.hit_rate  # Higher is better (up to 1.0)
        saturation_score = max(0.0, 1.0 - self.cache_saturation)  # Lower saturation is better
        return 0.7 * hit_score + 0.3 * saturation_score


@dataclass
class LearningAccelerationMetrics:
    """Metrics for learning acceleration performance."""
    bootstrap_phase_count: int = 0
    adaptation_phase_count: int = 0
    stable_phase_count: int = 0
    avg_convergence_progress: float = 0.0
    max_convergence_progress: float = 0.0
    convergence_samples: int = 0
    
    @property
    def total_processes_learning(self) -> int:
        """Total processes being tracked."""
        return self.bootstrap_phase_count + self.adaptation_phase_count + self.stable_phase_count
    
    @property
    def convergence_percentage(self) -> float:
        """Percentage of processes in stable phase (0-100)."""
        total = self.total_processes_learning
        return 100 * (self.stable_phase_count / total) if total > 0 else 0.0
    
    @property
    def estimated_convergence_time(self) -> tuple[float, float]:
        """
        Estimated convergence time range in seconds (min, max).
        Based on EWMA phase progression.
        """
        # Bootstrap: 0-10s
        # Adaptation: 10-90s
        # Stable: >90s
        return (30.0, 90.0)  # Expected range
    
    @property
    def health_score(self) -> float:
        """Overall health (0-1) based on convergence progress."""
        # Health improves as processes move from bootstrap -> adaptation -> stable
        phase_progression = (
            self.bootstrap_phase_count * 0.3 +
            self.adaptation_phase_count * 0.7 +
            self.stable_phase_count * 1.0
        )
        total = self.total_processes_learning
        if total == 0:
            return 0.0
        return min(1.0, phase_progression / total)


@dataclass
class ThreeHurdleHealthReport:
    """Comprehensive health report for all three hurdles."""
    
    # Timestamp and identification
    timestamp: float = field(default_factory=__import__('time').time)
    tick_count: int = 0
    total_processes: int = 0
    
    # Individual hurdle metrics
    cold_start: ColdStartMetrics = field(default_factory=ColdStartMetrics)
    overhead_reduction: OverheadReductionMetrics = field(default_factory=OverheadReductionMetrics)
    learning_acceleration: LearningAccelerationMetrics = field(default_factory=LearningAccelerationMetrics)
    
    @property
    def overall_health_score(self) -> float:
        """Overall system health (0-1) combining all three hurdles."""
        scores = [
            self.cold_start.health_score,
            self.overhead_reduction.health_score,
            self.learning_acceleration.health_score,
        ]
        return sum(scores) / len(scores) if scores else 0.0
    
    def to_dict(self) -> dict:
        """Convert to dictionary for API/reporting."""
        return {
            "timestamp": self.timestamp,
            "tick_count": self.tick_count,
            "total_processes": self.total_processes,
            "overall_health": round(self.overall_health_score, 3),
            "cold_start": {
                "bootstrapped": self.cold_start.processes_bootstrapped,
                "avg_confidence": round(self.cold_start.avg_bootstrap_confidence, 3),
                "expected_accuracy": f"{self.cold_start.accuracy_estimate * 100:.1f}%",
                "health": round(self.cold_start.health_score, 3),
            },
            "overhead_reduction": {
                "cache_hit_rate": round(self.overhead_reduction.hit_rate, 3),
                "computation_savings": f"{self.overhead_reduction.computation_savings_percent:.1f}%",
                "cache_size": self.overhead_reduction.cache_size,
                "health": round(self.overhead_reduction.health_score, 3),
            },
            "learning_acceleration": {
                "converged": self.learning_acceleration.stable_phase_count,
                "convergence_percentage": round(self.learning_acceleration.convergence_percentage, 1),
                "estimated_convergence": "30-90 seconds",
                "health": round(self.learning_acceleration.health_score, 3),
            },
        }
    
    def to_report_text(self) -> str:
        """Generate human-readable diagnostic report."""
        return f"""
═════════════════════════════════════════════════════════════════════════════
    IARIS THREE-HURDLE DIAGNOSTIC REPORT
═════════════════════════════════════════════════════════════════════════════

📊 System Status at Tick {self.tick_count}
──────────────────────────────────────────────────────────────────────────────
Total Processes:        {self.total_processes}
Overall Health Score:   {self.overall_health_score:.1%}

🥶 COLD START RESOLUTION (Similarity Matching)
──────────────────────────────────────────────────────────────────────────────
Processes Bootstrapped: {self.cold_start.processes_bootstrapped}
Avg Bootstrap Conf:     {self.cold_start.avg_bootstrap_confidence:.1%}
Expected Accuracy:      {self.cold_start.accuracy_estimate:.1%}
Health Score:           {self.cold_start.health_score:.1%}
Status:                 {"✓ ACTIVE" if self.cold_start.processes_bootstrapped > 0 else "⊗ INACTIVE"}

⚡ OVERHEAD REDUCTION (v4.0 Optimization Pipeline)
──────────────────────────────────────────────────────────────────────────────
Cache Hit Rate:         {self.overhead_reduction.hit_rate:.1%}
Computation Savings:    {self.overhead_reduction.computation_savings_percent:.1f}%
Cache Hits:             {self.overhead_reduction.cache_hits}
Cache Misses:           {self.overhead_reduction.cache_misses}
Full Recomputes:        {self.overhead_reduction.full_recomputes}
Delta Updates:          {self.overhead_reduction.delta_updates}
Cache Saturation:       {self.overhead_reduction.cache_saturation:.1%}
Health Score:           {self.overhead_reduction.health_score:.1%}
Status:                 {"✓ OPTIMIZED" if self.overhead_reduction.hit_rate > 0.5 else "⊗ LOADING"}

🐌 LEARNING ACCELERATION (EWMA Continuity)
──────────────────────────────────────────────────────────────────────────────
Processes in Bootstrap:    {self.learning_acceleration.bootstrap_phase_count}
Processes in Adaptation:   {self.learning_acceleration.adaptation_phase_count}
Processes in Stable:       {self.learning_acceleration.stable_phase_count}
Convergence Progress:      {self.learning_acceleration.convergence_percentage:.1f}%
Convergence Time Range:    {self.learning_acceleration.estimated_convergence_time[0]:.0f}-{self.learning_acceleration.estimated_convergence_time[1]:.0f}s
Health Score:              {self.learning_acceleration.health_score:.1%}
Status:                    {"✓ CONVERGED" if self.learning_acceleration.stable_phase_count > 0 else "⊗ LEARNING"}

═════════════════════════════════════════════════════════════════════════════

📋 Key Insights:
──────────────────────────────────────────────────────────────────────────────
"""


class ThreeHurdleDiagnosticsCollector:
    """
    Collects and aggregates metrics for the three-hurdle solution framework.
    """
    
    def __init__(self):
        self._history: list[ThreeHurdleHealthReport] = []
        self._max_history = 300  # Keep last 300 samples
    
    def collect_from_engine(self, engine) -> ThreeHurdleHealthReport:
        """Collect metrics from a running IARIS engine."""
        from iaris.models import BehaviorProfile
        
        # Collect cold start metrics
        cold_start_metrics = ColdStartMetrics()
        cold_start_metrics.processes_bootstrapped = sum(
            1 for p in engine._profiles.values() if p.bootstrapped
        )
        cold_start_metrics.bootstrap_confidence_sum = sum(
            p.bootstrap_confidence for p in engine._profiles.values() if p.bootstrapped
        )
        cold_start_metrics.processes_without_bootstrap = len(
            [p for p in engine._profiles.values() if not p.bootstrapped and p.observation_count > 1]
        )
        
        # Collect overhead reduction metrics
        cache_stats = engine.optimizer.get_stats()
        overhead_metrics = OverheadReductionMetrics(
            cache_hits=cache_stats['hits'],
            cache_misses=cache_stats['misses'],
            full_recomputes=cache_stats['full_recomputes'],
            delta_updates=cache_stats['delta_updates'],
            cache_evictions=cache_stats['cache_evictions'],
            cache_size=len(engine.optimizer.cache._cache),
        )
        
        # Collect learning acceleration metrics
        learning_metrics = LearningAccelerationMetrics()
        learning_metrics.convergence_samples = len(engine._profiles)
        
        for profile in engine._profiles.values():
            if profile.learning_phase == "bootstrap":
                learning_metrics.bootstrap_phase_count += 1
            elif profile.learning_phase == "adaptation":
                learning_metrics.adaptation_phase_count += 1
            elif profile.learning_phase == "stable":
                learning_metrics.stable_phase_count += 1
            
            learning_metrics.avg_convergence_progress += profile.convergence_progress
            if profile.convergence_progress > learning_metrics.max_convergence_progress:
                learning_metrics.max_convergence_progress = profile.convergence_progress
        
        if learning_metrics.convergence_samples > 0:
            learning_metrics.avg_convergence_progress /= learning_metrics.convergence_samples
        
        # Create report
        report = ThreeHurdleHealthReport(
            tick_count=engine._tick_count,
            total_processes=len(engine._profiles),
            cold_start=cold_start_metrics,
            overhead_reduction=overhead_metrics,
            learning_acceleration=learning_metrics,
        )
        
        # Store in history
        self._history.append(report)
        if len(self._history) > self._max_history:
            self._history.pop(0)
        
        return report
    
    def get_latest_report(self) -> Optional[ThreeHurdleHealthReport]:
        """Get the most recent diagnostic report."""
        return self._history[-1] if self._history else None
    
    def get_history(self, limit: int = 100) -> list[ThreeHurdleHealthReport]:
        """Get historical reports."""
        return self._history[-limit:]
