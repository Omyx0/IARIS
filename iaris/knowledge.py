"""
IARIS Knowledge Base — SQLite-backed Persistent Storage

Stores learned behavior profiles, decisions, and system state history.
Uses aiosqlite for async operations. Falls back to in-memory if file-based fails.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Optional

from iaris.models import BehaviorProfile, BehaviorType, AllocationDecision

logger = logging.getLogger("iaris.knowledge")

# Default DB path
DEFAULT_DB_PATH = os.path.join(os.path.expanduser("~"), ".iaris", "knowledge.db")


class KnowledgeBase:
    """
    Persistent storage for IARIS learned behaviors and decision history.

    Uses SQLite for cross-session persistence with in-memory caching for speed.
    """

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or DEFAULT_DB_PATH
        self._conn: Optional[sqlite3.Connection] = None
        self._profile_cache: dict[str, dict] = {}  # signature -> profile data
        self._recipe_cache: dict[str, dict] = {}    # name -> recipe data

    def initialize(self) -> None:
        """Initialize database and create tables if needed."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")

        self._create_tables()
        self._load_cache()
        logger.info(f"Knowledge base initialized at {self.db_path}")

    def _create_tables(self) -> None:
        """Create database tables."""
        assert self._conn is not None

        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS behavior_profiles (
                signature TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                behavior_type TEXT NOT NULL,
                avg_cpu REAL DEFAULT 0,
                avg_memory REAL DEFAULT 0,
                avg_io_rate REAL DEFAULT 0,
                burstiness REAL DEFAULT 0,
                blocking_ratio REAL DEFAULT 0,
                criticality REAL DEFAULT 0.5,
                observation_count INTEGER DEFAULT 0,
                first_seen REAL,
                last_seen REAL,
                created_at REAL DEFAULT (strftime('%s', 'now')),
                updated_at REAL DEFAULT (strftime('%s', 'now'))
            );

            CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pid INTEGER,
                process_name TEXT,
                action TEXT,
                score REAL,
                reason TEXT,
                system_state TEXT,
                behavior_type TEXT,
                timestamp REAL DEFAULT (strftime('%s', 'now'))
            );

            CREATE TABLE IF NOT EXISTS system_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cpu_percent REAL,
                memory_percent REAL,
                state TEXT,
                behavior TEXT,
                process_count INTEGER,
                timestamp REAL DEFAULT (strftime('%s', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp);
            CREATE INDEX IF NOT EXISTS idx_system_history_timestamp ON system_history(timestamp);
            CREATE INDEX IF NOT EXISTS idx_profiles_name ON behavior_profiles(name);
        """)
        self._conn.commit()

    def _load_cache(self) -> None:
        """Load existing profiles into memory cache."""
        assert self._conn is not None

        cursor = self._conn.execute("SELECT * FROM behavior_profiles")
        for row in cursor:
            self._profile_cache[row["signature"]] = dict(row)

        logger.info(f"Loaded {len(self._profile_cache)} behavior profiles from DB")

    def save_profile(self, profile: BehaviorProfile) -> None:
        """Save or update a behavior profile."""
        if not self._conn or not profile.signature:
            return

        data = {
            "signature": profile.signature,
            "name": profile.name,
            "behavior_type": profile.behavior_type.value,
            "avg_cpu": profile.avg_cpu,
            "avg_memory": profile.avg_memory,
            "avg_io_rate": profile.avg_io_rate,
            "burstiness": profile.burstiness,
            "blocking_ratio": profile.blocking_ratio,
            "criticality": profile.criticality,
            "observation_count": profile.observation_count,
            "first_seen": profile.first_seen,
            "last_seen": profile.last_seen,
            "updated_at": time.time(),
        }

        self._conn.execute("""
            INSERT OR REPLACE INTO behavior_profiles
            (signature, name, behavior_type, avg_cpu, avg_memory, avg_io_rate,
             burstiness, blocking_ratio, criticality, observation_count,
             first_seen, last_seen, updated_at)
            VALUES (:signature, :name, :behavior_type, :avg_cpu, :avg_memory,
                    :avg_io_rate, :burstiness, :blocking_ratio, :criticality,
                    :observation_count, :first_seen, :last_seen, :updated_at)
        """, data)
        self._conn.commit()

        # Update cache
        self._profile_cache[profile.signature] = data

    def lookup_profile(self, signature: str) -> Optional[dict]:
        """Look up a known behavior profile by signature."""
        return self._profile_cache.get(signature)

    def lookup_by_name(self, name: str) -> Optional[dict]:
        """Look up the most recent profile for a process name."""
        matches = [p for p in self._profile_cache.values() if p["name"] == name]
        if matches:
            return max(matches, key=lambda p: p.get("last_seen", 0))
        return None
    
    def get_all_profiles(self) -> dict[str, dict]:
        """Get all cached profiles for similarity matching."""
        return self._profile_cache.copy()

    def apply_learned_profile(self, profile: BehaviorProfile) -> bool:
        """Apply previously learned profile data to a new profile."""
        # Try by signature first
        known = self.lookup_profile(profile.signature)

        # Fall back to name
        if not known:
            known = self.lookup_by_name(profile.name)

        if known:
            profile.avg_cpu = known["avg_cpu"]
            profile.avg_memory = known["avg_memory"]
            profile.avg_io_rate = known["avg_io_rate"]
            profile.burstiness = known["burstiness"]
            profile.blocking_ratio = known["blocking_ratio"]
            profile.criticality = known["criticality"]
            try:
                profile.behavior_type = BehaviorType(known["behavior_type"])
            except ValueError:
                pass
            logger.debug(f"Applied learned profile for '{profile.name}' (sig: {profile.signature})")
            return True

        return False

    def save_decision(self, decision: AllocationDecision) -> None:
        """Record a decision in the history."""
        if not self._conn:
            return

        self._conn.execute("""
            INSERT INTO decisions (pid, process_name, action, score, reason,
                                   system_state, behavior_type, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            decision.pid, decision.process_name, decision.action.value,
            decision.score, decision.reason, decision.system_state.value,
            decision.behavior_type.value, decision.timestamp,
        ))
        self._conn.commit()

    def save_system_snapshot(self, cpu: float, memory: float, state: str,
                             behavior: str, process_count: int) -> None:
        """Record a system snapshot in history."""
        if not self._conn:
            return

        self._conn.execute("""
            INSERT INTO system_history (cpu_percent, memory_percent, state,
                                        behavior, process_count)
            VALUES (?, ?, ?, ?, ?)
        """, (cpu, memory, state, behavior, process_count))
        self._conn.commit()

    def get_recent_decisions(self, limit: int = 50) -> list[dict]:
        """Get recent allocation decisions."""
        if not self._conn:
            return []

        cursor = self._conn.execute(
            "SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?", (limit,)
        )
        return [dict(row) for row in cursor]

    def get_system_history(self, limit: int = 300) -> list[dict]:
        """Get recent system snapshots (default: last 5 minutes at 1s interval)."""
        if not self._conn:
            return []

        cursor = self._conn.execute(
            "SELECT * FROM system_history ORDER BY timestamp DESC LIMIT ?", (limit,)
        )
        return [dict(row) for row in cursor]

    def close(self) -> None:
        """Close database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None
            logger.info("Knowledge base closed")


# ─── Recipe Loader ───────────────────────────────────────────────────────────

class RecipeLoader:
    """Loads cold-start JSON recipes for known process behavior profiles."""

    def __init__(self, recipe_dir: Optional[str] = None):
        self.recipe_dir = recipe_dir or os.path.join(
            os.path.dirname(__file__), "recipes"
        )
        self._recipes: dict[str, dict] = {}

    def load(self) -> dict[str, dict]:
        """Load all recipes from the recipe directory.

        Supports two JSON formats:
        - Bundle: {"name": "...", "recipes": [{...}, ...]}  (preferred)
        - Single: {"name": "...", "patterns": [...], ...}   (legacy)
        """
        recipe_path = Path(self.recipe_dir)
        if not recipe_path.exists():
            logger.debug(f"No recipe directory at {self.recipe_dir}")
            return {}

        for f in recipe_path.glob("*.json"):
            try:
                with open(f) as fp:
                    data = json.load(fp)

                # Bundle format: top-level object with a "recipes" list
                if isinstance(data, dict) and "recipes" in data:
                    for recipe in data["recipes"]:
                        rname = recipe.get("name", f.stem)
                        self._recipes[rname] = recipe
                        logger.debug(f"Loaded recipe: {rname}")
                # Single recipe dict
                elif isinstance(data, dict):
                    rname = data.get("name", f.stem)
                    self._recipes[rname] = data
                    logger.debug(f"Loaded recipe: {rname}")
                else:
                    logger.warning(f"Skipping {f}: unexpected format (got {type(data).__name__})")

            except Exception as e:
                logger.warning(f"Failed to load recipe {f}: {e}")

        logger.info(f"Loaded {len(self._recipes)} cold-start recipes")
        return self._recipes

    def get_recipe(self, process_name: str) -> Optional[dict]:
        """Find a matching recipe for a process name."""
        name_lower = process_name.lower()
        for recipe_name, recipe in self._recipes.items():
            patterns = recipe.get("patterns", [recipe_name])
            if any(p.lower() in name_lower for p in patterns):
                return recipe
        return None
