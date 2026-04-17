"""
IARIS observability primitives.

Builds deterministic snapshots and diffs so every state change is explicit.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

from iaris.models import ProcessMetrics, SystemSnapshot


def build_snapshot(system: SystemSnapshot, processes: dict[int, ProcessMetrics]) -> dict:
    """Build a stable, comparable snapshot shape."""
    process_names = sorted({m.name for m in processes.values() if m.name})
    return {
        "timestamp": int(system.timestamp),
        "cpu": round(system.cpu_percent, 1),
        "memory": round(system.memory_percent, 1),
        "disk": round(system.disk_percent, 1),
        "processes": process_names,
    }


def compute_diff(old_snap: Optional[dict], new_snap: dict) -> dict:
    """Compute deterministic diff between two snapshots."""
    if old_snap is None:
        return {"initial": True}

    changes: dict = {}

    for key in ("cpu", "memory", "disk"):
        old_val = old_snap.get(key)
        new_val = new_snap.get(key)
        if old_val != new_val:
            changes[key] = {
                "old": old_val,
                "new": new_val,
                "delta": round(float(new_val) - float(old_val), 1),
            }

    old_processes = set(old_snap.get("processes", []))
    new_processes = set(new_snap.get("processes", []))
    added = sorted(new_processes - old_processes)
    removed = sorted(old_processes - new_processes)
    if added or removed:
        changes["processes"] = {
            "old": sorted(old_processes),
            "new": sorted(new_processes),
            "added": added,
            "removed": removed,
            "delta": len(new_processes) - len(old_processes),
        }

    return changes


def should_recompute(diff: dict) -> tuple[bool, str]:
    """Decide whether the intelligence layer should recompute."""
    if not diff:
        return False, "No change detected"

    if diff.get("initial"):
        return True, "Initial baseline snapshot"

    proc_diff = diff.get("processes")
    if proc_diff and (proc_diff.get("added") or proc_diff.get("removed")):
        return True, "Process list changed"

    cpu_diff = diff.get("cpu")
    if cpu_diff and abs(cpu_diff.get("delta", 0.0)) > 10:
        return True, "CPU changed more than 10%"

    mem_diff = diff.get("memory")
    if mem_diff and abs(mem_diff.get("delta", 0.0)) > 15:
        return True, "Memory changed more than 15%"

    disk_diff = diff.get("disk")
    if disk_diff and abs(disk_diff.get("delta", 0.0)) > 20:
        return True, "Disk changed more than 20%"

    return False, "No meaningful change"


def classify_severity(field: str, payload: dict) -> str:
    """Classify severity as minor, moderate, or major."""
    if field == "processes":
        if payload.get("added"):
            return "major"
        if payload.get("removed"):
            return "moderate"
        return "minor"

    delta = abs(float(payload.get("delta", 0.0)))
    if delta > 20:
        return "major"
    if delta >= 10:
        return "moderate"
    return "minor"


@dataclass
class ObservabilityUpdate:
    snapshot: dict
    diff: dict
    changes: list[dict]
    recent_changes: list[dict]
    significant: bool
    significance_reason: str

    def to_dict(self) -> dict:
        return {
            "snapshot": self.snapshot,
            "diff": self.diff,
            "changes": self.changes,
            "recent_changes": self.recent_changes,
            "significant": self.significant,
            "significance_reason": self.significance_reason,
        }


class ObservabilityTracker:
    """Tracks snapshot history and produces per-tick change events."""

    def __init__(self, max_events: int = 180):
        self._previous_snapshot: Optional[dict] = None
        self._recent_changes: deque[dict] = deque(maxlen=max_events)

    def update(self, snapshot: dict) -> ObservabilityUpdate:
        diff = compute_diff(self._previous_snapshot, snapshot)
        significant, reason = should_recompute(diff)

        change_events: list[dict] = []
        if diff.get("initial"):
            change_events.append(
                {
                    "timestamp": snapshot["timestamp"],
                    "field": "baseline",
                    "severity": "minor",
                    "message": "Baseline snapshot initialized",
                }
            )
        else:
            for field, payload in diff.items():
                severity = classify_severity(field, payload)
                if field == "processes":
                    added = payload.get("added", [])
                    removed = payload.get("removed", [])
                    message_parts = []
                    if added:
                        message_parts.append(f"Process added: {', '.join(added[:5])}")
                    if removed:
                        message_parts.append(f"Process removed: {', '.join(removed[:5])}")
                    message = " | ".join(message_parts) if message_parts else "Process list changed"
                else:
                    message = (
                        f"{field.upper()}: {payload.get('old')} -> {payload.get('new')} "
                        f"(delta {payload.get('delta'):+.1f})"
                    )

                event = {
                    "timestamp": snapshot["timestamp"],
                    "field": field,
                    "severity": severity,
                    "message": message,
                    "detail": payload,
                }
                change_events.append(event)

        for event in change_events:
            self._recent_changes.append(event)

        self._previous_snapshot = snapshot

        return ObservabilityUpdate(
            snapshot=snapshot,
            diff=diff,
            changes=change_events,
            recent_changes=list(self._recent_changes),
            significant=significant,
            significance_reason=reason,
        )
