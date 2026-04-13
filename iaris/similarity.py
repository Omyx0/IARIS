"""
IARIS Similarity Matching Engine — Cold Start Solution

Addresses the cold start problem by matching new processes with similar
existing workloads and inheriting their learned behavior.

Key Components:
  1. Signature Vector — lightweight features for comparison
  2. Similarity Scoring — weighted distance metrics
  3. Bootstrap Logic — initialize new processes from similar profiles
"""

from __future__ import annotations

import difflib
import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

from iaris.models import BehaviorProfile, BehaviorType, ProcessMetrics

logger = logging.getLogger("iaris.similarity")


@dataclass
class SignatureVector:
    """Lightweight feature vector for process similarity matching."""
    
    # Process identification
    executable_name: str
    
    # Behavioral characteristics
    port_usage: set[int]
    typical_cpu_percent: float
    typical_memory_percent: float
    typical_io_rate: float
    
    # Workload pattern
    burstiness_level: str  # "low", "medium", "high"
    blocking_tendency: str  # "cpu_bound", "io_bound", "balanced"
    
    # Derived behavior type (for reference)
    inferred_type: BehaviorType
    
    @classmethod
    def from_profile(cls, profile: BehaviorProfile) -> SignatureVector:
        """Extract signature vector from learned behavior profile."""
        # Determine burstiness level
        if profile.burstiness < 0.1:
            burstiness = "low"
        elif profile.burstiness < 0.5:
            burstiness = "medium"
        else:
            burstiness = "high"
        
        # Determine blocking tendency
        if profile.blocking_ratio > 0.7:
            blocking = "io_bound"
        elif profile.blocking_ratio < 0.2:
            blocking = "cpu_bound"
        else:
            blocking = "balanced"
        
        return cls(
            executable_name=profile.name,
            port_usage=getattr(profile, 'ports', set()),
            typical_cpu_percent=profile.avg_cpu,
            typical_memory_percent=profile.avg_memory,
            typical_io_rate=profile.avg_io_rate,
            burstiness_level=burstiness,
            blocking_tendency=blocking,
            inferred_type=profile.behavior_type,
        )
    
    @classmethod
    def from_metrics(cls, metrics: ProcessMetrics) -> SignatureVector:
        """Extract signature vector from process metrics (new process)."""
        # Estimate burstiness from initial data (will be refined later)
        burstiness = "medium"  # Conservative default
        
        # Estimate blocking from status
        if metrics.status in ("sleeping", "disk-sleep", "stopped"):
            blocking = "io_bound"
        else:
            blocking = "cpu_bound" if metrics.cpu_percent > metrics.io_read_rate else "balanced"
        
        return cls(
            executable_name=metrics.name,
            port_usage=getattr(metrics, 'ports', set()),
            typical_cpu_percent=metrics.cpu_percent,
            typical_memory_percent=metrics.memory_percent,
            typical_io_rate=metrics.io_read_rate + metrics.io_write_rate,
            burstiness_level=burstiness,
            blocking_tendency=blocking,
            inferred_type=BehaviorType.UNKNOWN,
        )


class SimilarityMatcher:
    """
    Matches new processes with learned profiles to bootstrap behavior.
    
    Similarity Formula:
        similarity_score = weighted sum of component similarities
        
    Components:
      - Name similarity (string)
      - Resource usage similarity (numeric)
      - Pattern similarity (categorical)
    
    Returns scores in range [0.0, 1.0] where 1.0 = perfect match.
    """
    
    def __init__(self):
        # Component weights (sum to 1.0)
        self.w_name = 0.30          # Executable name importance
        self.w_resources = 0.40     # CPU/memory/IO pattern
        self.w_pattern = 0.30       # Burstiness and blocking behavior
        
        # Thresholds
        self.bootstrap_threshold = 0.60  # Minimum similarity to apply bootstrap
        self.high_confidence_threshold = 0.75
    
    def compute_similarity(
        self,
        signature_new: SignatureVector,
        signature_known: SignatureVector,
    ) -> float:
        """
        Compute similarity between new and known process signatures.
        
        Returns score in [0.0, 1.0].
        """
        name_sim = self._similarity_name(signature_new.executable_name, signature_known.executable_name)
        resource_sim = self._similarity_resources(signature_new, signature_known)
        pattern_sim = self._similarity_pattern(signature_new, signature_known)
        
        total = (
            self.w_name * name_sim +
            self.w_resources * resource_sim +
            self.w_pattern * pattern_sim
        )
        
        return max(0.0, min(1.0, total))
    
    def _similarity_name(self, name1: str, name2: str) -> float:
        """
        Compute executable name similarity using string matching.
        
        Uses normalized sequence matching to handle variations like:
          - "python.exe" vs "python"
          - "java" vs "java.exe"
          - "svc_httpd" vs "httpd"
        """
        # Extract base names (strip extensions and paths)
        base1 = self._extract_base_name(name1)
        base2 = self._extract_base_name(name2)
        
        # Exact match
        if base1.lower() == base2.lower():
            return 1.0
        
        # Contains keyword match (e.g., 'python' in 'python-service')
        if (base1.lower() in base2.lower() or base2.lower() in base1.lower()):
            return 0.75
        
        # Fuzzy string matching (sequence ratio)
        matcher = difflib.SequenceMatcher(None, base1.lower(), base2.lower())
        ratio = matcher.ratio()
        
        return ratio
    
    def _extract_base_name(self, name: str) -> str:
        """Extract base executable name from path/version string."""
        # Remove file extensions
        name = re.sub(r'\.(exe|cmd|sh|py|bat|ps1)$', '', name, flags=re.IGNORECASE)
        
        # Take last component of path
        if '\\' in name:
            name = name.split('\\')[-1]
        elif '/' in name:
            name = name.split('/')[-1]
        
        # Remove version numbers and common suffixes
        name = re.sub(r'[_-]v?\d+(\.\d+)*', '', name)
        name = re.sub(r'(service|svc|worker|daemon)$', '', name, flags=re.IGNORECASE)
        
        return name.strip()
    
    def _similarity_resources(self, sig1: SignatureVector, sig2: SignatureVector) -> float:
        """
        Compute similarity of resource usage patterns.
        
        Compares CPU, memory, and I/O characteristics.
        """
        # Normalize resource values to [0, 1] scale
        cpu_diff = abs(sig1.typical_cpu_percent - sig2.typical_cpu_percent) / 100.0
        cpu_sim = 1.0 - min(1.0, cpu_diff)
        
        mem_diff = abs(sig1.typical_memory_percent - sig2.typical_memory_percent) / 100.0
        mem_sim = 1.0 - min(1.0, mem_diff)
        
        # I/O rate is unbounded, use logarithmic scale
        io_ratio = max(sig1.typical_io_rate, sig2.typical_io_rate)
        if io_ratio > 0:
            io_diff = abs(sig1.typical_io_rate - sig2.typical_io_rate) / (io_ratio + 1.0)
            io_sim = 1.0 - min(1.0, io_diff)
        else:
            io_sim = 1.0  # Both are zero
        
        # Weighted average of resource similarities
        return 0.4 * cpu_sim + 0.4 * mem_sim + 0.2 * io_sim
    
    def _similarity_pattern(self, sig1: SignatureVector, sig2: SignatureVector) -> float:
        """
        Compute similarity of workload patterns.
        
        Compares burstiness and blocking characteristics.
        """
        # Burstiness category match
        burstiness_match = 1.0 if sig1.burstiness_level == sig2.burstiness_level else 0.5
        
        # Blocking tendency match
        blocking_match = 1.0 if sig1.blocking_tendency == sig2.blocking_tendency else 0.5
        
        return 0.5 * burstiness_match + 0.5 * blocking_match
    
    def find_similar_profiles(
        self,
        signature_new: SignatureVector,
        known_profiles: dict[str, BehaviorProfile],
        top_n: int = 3,
    ) -> list[tuple[BehaviorProfile, float]]:
        """
        Find the most similar known profiles to a new process.
        
        Returns list of (profile, similarity_score) tuples, sorted by score descending.
        """
        matches: list[tuple[BehaviorProfile, float]] = []
        
        for sig, profile in known_profiles.items():
            if profile and profile.observation_count >= 10:  # Only use well-learned profiles
                sig_known = SignatureVector.from_profile(profile)
                score = self.compute_similarity(signature_new, sig_known)
                
                if score >= self.bootstrap_threshold:
                    matches.append((profile, score))
        
        # Sort by score descending, return top N
        matches.sort(key=lambda x: x[1], reverse=True)
        return matches[:top_n]
    
    def bootstrap_profile(
        self,
        profile_new: BehaviorProfile,
        similar_profiles: list[tuple[BehaviorProfile, float]],
    ) -> BehaviorProfile:
        """
        Bootstrap a new profile using weighted average of similar profiles.
        
        Applies learned behavior characteristics to new process to achieve
        ~80-85% initial approximation.
        """
        if not similar_profiles:
            logger.debug(f"No similar profiles found for {profile_new.name}, skipping bootstrap")
            return profile_new
        
        # Compute weighted average of similar profiles
        total_weight = sum(score for _, score in similar_profiles)
        
        if total_weight == 0:
            return profile_new
        
        avg_criticality = 0.0
        avg_latency_sensitivity = 0.0
        bootstrapped_type = similar_profiles[0][0].behavior_type  # Take first type
        confidence = 0.0
        
        for profile, score in similar_profiles:
            normalized_weight = score / total_weight
            avg_criticality += profile.criticality * normalized_weight
            avg_latency_sensitivity += profile.latency_sensitivity * normalized_weight
            confidence += score * normalized_weight
        
        # Update new profile with bootstrapped values
        # Use conservative multiplier (0.8-0.95) to reflect uncertainty
        confidence_factor = 0.85  # 85% confidence in bootstrap
        
        profile_new.criticality = avg_criticality * confidence_factor + 0.5 * (1 - confidence_factor)
        profile_new.latency_sensitivity = avg_latency_sensitivity * confidence_factor + 0.5 * (1 - confidence_factor)
        profile_new.behavior_type = bootstrapped_type
        profile_new.bootstrapped = True
        profile_new.bootstrap_confidence = confidence
        
        logger.info(
            f"Bootstrap: {profile_new.name} (pid={profile_new.pid}) "
            f"from {len(similar_profiles)} similar profiles, "
            f"confidence={confidence:.2f}"
        )
        
        return profile_new


class ColdStartResolver:
    """
    End-to-end cold start resolution.
    
    Orchestrates signature extraction, similarity matching, and profile bootstrapping.
    """
    
    def __init__(self):
        self.matcher = SimilarityMatcher()
    
    def resolve(
        self,
        metrics_new: ProcessMetrics,
        profile_new: BehaviorProfile,
        known_profiles: dict[str, BehaviorProfile],
    ) -> BehaviorProfile:
        """
        Resolve cold start for a new process.
        
        Returns updated profile with bootstrapped behavior (if similar profiles found),
        or original profile if no matches.
        """
        # Convert any dicts to BehaviorProfile objects
        converted_profiles: dict[str, BehaviorProfile] = {}
        for sig, profile_data in known_profiles.items():
            if isinstance(profile_data, dict):
                # Convert dict to BehaviorProfile, filtering out database-only fields
                try:
                    behavior_type_str = profile_data.get('behavior_type', 'unknown')
                    if isinstance(behavior_type_str, str):
                        profile_data['behavior_type'] = BehaviorType(behavior_type_str)
                    else:
                        profile_data['behavior_type'] = behavior_type_str
                except (ValueError, KeyError):
                    profile_data['behavior_type'] = BehaviorType.UNKNOWN
                
                # Extract only valid BehaviorProfile fields
                valid_fields = {
                    'pid', 'name', 'behavior_type', 'signature',
                    'avg_cpu', 'avg_memory', 'avg_io_rate',
                    'burstiness', 'blocking_ratio',
                    'criticality', 'latency_sensitivity', 'allocation_score',
                    'observation_count', 'first_seen', 'last_seen',
                    'bootstrapped', 'bootstrap_confidence', 'bootstrap_source',
                    'learning_phase', 'convergence_progress'
                }
                filtered_data = {k: v for k, v in profile_data.items() if k in valid_fields}
                
                # Ensure pid is present (use 0 for reference profiles from knowledge base)
                if 'pid' not in filtered_data:
                    filtered_data['pid'] = 0
                
                # Ensure name is present
                if 'name' not in filtered_data:
                    filtered_data['name'] = profile_data.get('name', 'unknown')
                
                converted_profiles[sig] = BehaviorProfile(**filtered_data)
            else:
                converted_profiles[sig] = profile_data
        
        # Extract signature from new process
        sig_new = SignatureVector.from_metrics(metrics_new)
        
        # Find similar profiles
        similar = self.matcher.find_similar_profiles(sig_new, converted_profiles)
        
        # Bootstrap if similar profiles found
        if similar:
            profile_new = self.matcher.bootstrap_profile(profile_new, similar)
        
        return profile_new
