"""
IARIS intelligence layer.

Runs selective insight recomputation and reuses cached insight when changes are minor.
Optionally uses Gemini only on meaningful changes.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

from iaris.credentials import CredentialStore

logger = logging.getLogger("iaris.intelligence")

GEMINI_ENDPOINT_CANDIDATES = (
    ("v1", "gemini-2.0-flash"),
    ("v1beta", "gemini-2.0-flash"),
    ("v1beta", "gemini-1.5-flash"),
    ("v1beta", "gemini-1.5-pro"),
)


@dataclass
class InsightCacheEntry:
    insight: str
    source: str
    timestamp: float


class IntelligenceLayer:
    """Applies significance gating and cache reuse for high-level insights."""

    def __init__(self, cache_ttl_seconds: int = 45):
        self.cache_ttl_seconds = cache_ttl_seconds
        self._cache: Optional[InsightCacheEntry] = None

    def evaluate(
        self,
        *,
        observability: dict,
        engine_insights: list[dict],
        credentials: CredentialStore,
    ) -> dict:
        """Evaluate current state and decide whether to recompute or reuse insight."""
        now = time.time()
        significant = bool(observability.get("significant", False))
        reason = observability.get("significance_reason", "")

        if not significant and self._cache:
            cache_age = int(now - self._cache.timestamp)
            if cache_age <= self.cache_ttl_seconds:
                return {
                    "significant": False,
                    "reason": reason,
                    "used_cache": True,
                    "source": "cache",
                    "insight": self._cache.insight,
                    "last_updated": self._cache.timestamp,
                    "cache_age_seconds": cache_age,
                    "cache_ttl_seconds": self.cache_ttl_seconds,
                }

        if significant:
            fresh_insight, source = self._compute_fresh_insight(
                observability=observability,
                engine_insights=engine_insights,
                credentials=credentials,
            )
            self._cache = InsightCacheEntry(insight=fresh_insight, source=source, timestamp=now)
            return {
                "significant": True,
                "reason": reason,
                "used_cache": False,
                "source": source,
                "insight": fresh_insight,
                "last_updated": now,
                "cache_age_seconds": 0,
                "cache_ttl_seconds": self.cache_ttl_seconds,
            }

        # No significant changes and no valid cache.
        fallback = "System stable. No significant changes detected. Reusing previous operating posture."
        self._cache = InsightCacheEntry(insight=fallback, source="local", timestamp=now)
        return {
            "significant": False,
            "reason": reason,
            "used_cache": False,
            "source": "local",
            "insight": fallback,
            "last_updated": now,
            "cache_age_seconds": 0,
            "cache_ttl_seconds": self.cache_ttl_seconds,
        }

    def _compute_fresh_insight(
        self,
        *,
        observability: dict,
        engine_insights: list[dict],
        credentials: CredentialStore,
    ) -> tuple[str, str]:
        local_summary = self._build_local_summary(observability=observability, engine_insights=engine_insights)

        # External AI is opt-in so the system remains safe and predictable by default.
        if credentials.has_gemini_key and os.getenv("IARIS_ENABLE_GEMINI", "0") == "1":
            remote_summary = self._query_gemini(
                gemini_key=credentials.gemini_api_key,
                observability=observability,
                local_summary=local_summary,
            )
            if remote_summary:
                return remote_summary, "gemini"

        return local_summary, "local"

    @staticmethod
    def _build_local_summary(*, observability: dict, engine_insights: list[dict]) -> str:
        diff = observability.get("diff", {})

        proc_diff = diff.get("processes", {})
        if proc_diff.get("added"):
            names = ", ".join(proc_diff["added"][:3])
            return (
                f"Significant process change detected. Newly observed process(es): {names}. "
                "Monitor CPU and memory impact over the next 30 seconds."
            )

        cpu = diff.get("cpu")
        if cpu and abs(cpu.get("delta", 0.0)) > 20:
            direction = "increase" if cpu["delta"] > 0 else "decrease"
            return (
                f"Major CPU {direction} detected ({cpu.get('old')} -> {cpu.get('new')}). "
                "Investigate active high-load processes and rebalance workload priority."
            )

        memory = diff.get("memory")
        if memory and abs(memory.get("delta", 0.0)) > 15:
            direction = "increase" if memory["delta"] > 0 else "decrease"
            return (
                f"Major memory {direction} detected ({memory.get('old')} -> {memory.get('new')}). "
                "Inspect memory-heavy processes and reclaim non-critical workloads if needed."
            )

        if engine_insights:
            first = engine_insights[0]
            recommendation = first.get("recommendation", "Continue monitoring trend stability.")
            return f"{first.get('message', 'Meaningful change detected.')} Recommendation: {recommendation}"

        return "Meaningful change detected. Continue monitoring for sustained trend shifts."

    @staticmethod
    def _query_gemini(*, gemini_key: str, observability: dict, local_summary: str) -> Optional[str]:
        prompt = (
            "You are monitoring live system metrics. Provide one concise operational insight "
            "and one recommendation. Keep under 40 words.\n"
            f"Observability payload: {json.dumps(observability, separators=(',', ':'))}\n"
            f"Local summary: {local_summary}"
        )

        req_payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt,
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 120,
            },
        }
        for api_version, model_name in GEMINI_ENDPOINT_CANDIDATES:
            endpoint = (
                f"https://generativelanguage.googleapis.com/{api_version}/models/"
                f"{model_name}:generateContent?key={gemini_key}"
            )

            req = urllib.request.Request(
                endpoint,
                data=json.dumps(req_payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            try:
                with urllib.request.urlopen(req, timeout=3.0) as response:
                    body = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                # Model availability varies by account/region; try the next candidate.
                if exc.code == 404:
                    logger.debug("Gemini model unavailable (%s/%s)", api_version, model_name)
                    continue
                logger.debug("Gemini HTTP error for %s/%s: %s", api_version, model_name, exc)
                continue
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                logger.debug("Gemini summary unavailable for %s/%s: %s", api_version, model_name, exc)
                continue

            candidates = body.get("candidates") or []
            if not candidates:
                continue

            parts = (
                candidates[0]
                .get("content", {})
                .get("parts", [])
            )
            if not parts:
                continue

            text = parts[0].get("text", "").strip()
            if text:
                return text

        return None
