# IARIS Three-Hurdle Quick Reference

Complete implementation of the adaptive resource intelligence three-hurdle solution framework.

## 📦 Module Guide

### 🥶 Cold Start: `iaris/similarity.py`

**Purpose:** Resolve cold start by finding similar learned processes

**Main Classes:**
- `SignatureVector` - Process fingerprint (name, ports, CPU/IO patterns, burstiness)
- `SimilarityMatcher` - Computes weighted similarity scores
- `ColdStartResolver` - End-to-end orchestration

**Usage:**
```python
from iaris.similarity import ColdStartResolver

resolver = ColdStartResolver()
profile = resolver.resolve(new_metrics, new_profile, known_profiles)
# Result: profile.bootstrapped = True, profile.bootstrap_confidence = 0.75
```

**Key Tuning:**
```python
matcher.w_name = 0.30          # Executable name importance
matcher.w_resources = 0.40     # CPU/memory/IO pattern  
matcher.w_pattern = 0.30       # Burstiness/blocking behavior
matcher.bootstrap_threshold = 0.60  # Min similarity for bootstrap
```

---

### ⚡ Overhead: `iaris/cache.py`

**Purpose:** Reduce CPU overhead through intelligent caching

**Main Classes:**
- `CacheEntry` - Single cached computation with state continuity
- `DeltaComputation` - Incremental change tracking
- `CachingLayer` - Batch cache with LRU/TTL eviction
- `OptimizationPipeline` - Orchestrates all layers

**Usage:**
```python
from iaris.cache import OptimizationPipeline

pipeline = OptimizationPipeline(max_cache_size=10000, default_ttl=30)

# Check cache
cached = pipeline.cache.lookup(pid)

# Record result
pipeline.record_computation(pid, name, profile, decision)

# Get statistics
stats = pipeline.get_stats()
hit_rate = stats['hits'] / (stats['hits'] + stats['misses'])
```

**Key Parameters:**
```python
max_cache_size = 10000        # Max entries before LRU eviction
default_ttl = 30              # Cache entry lifetime (seconds)
cpu_delta_threshold = 2.0     # CPU% change to trigger recompute
memory_delta_threshold = 2.0  # Memory% change threshold
io_delta_threshold = 10.0     # I/O% change threshold
```

---

### 🐌 Learning: `iaris/continuity.py`

**Purpose:** Accelerate learning through EWMA continuity without resets

**Main Classes:**
- `EWMAState` - Preserves EWMA values across computations
- `EWMAContinuityEngine` - Manages learning phases and spike detection
- `LearningAccelerator` - End-to-end learning orchestration

**Usage:**
```python
from iaris.continuity import LearningAccelerator

accelerator = LearningAccelerator()

# Apply continuity-constrained EWMA
new_metrics = {'cpu': 50.0, 'memory': 30.0, 'io': 1000.0}
profile = accelerator.apply_continuity_update(profile, new_metrics)

# Check progress
status = accelerator.get_learning_status(pid)
# Returns: phase, progress, age, is_converged
```

**Learning Phases:**
| Phase | Duration | Alpha | Notes |
|-------|----------|-------|-------|
| Bootstrap | 0-10s | 0.5 | Fast learning from similarity |
| Adaptation | 10-90s | 0.3→0.1 | Gradual convergence |
| Stable | >90s | 0.1 | Stable with slow drift |

---

### 📊 Diagnostics: `iaris/diagnostics.py`

**Purpose:** Real-time monitoring of all three hurdles

**Main Classes:**
- `ColdStartMetrics` - Bootstrap success rates
- `OverheadReductionMetrics` - Cache performance stats
- `LearningAccelerationMetrics` - Convergence progress
- `ThreeHurdleHealthReport` - Combined health assessment
- `ThreeHurdleDiagnosticsCollector` - Automatic collection

**Usage:**
```python
from iaris.diagnostics import ThreeHurdleDiagnosticsCollector

collector = ThreeHurdleDiagnosticsCollector()
report = collector.collect_from_engine(engine)

# Text report
print(report.to_report_text())

# JSON for API
data = report.to_dict()
health = report.overall_health_score  # 0.0-1.0
```

---

## 🔗 Integration Architecture

```
engine._process_tick()
├─ Classify behavior (EXISTING)
├─ 🥶 COLD START: similarity.ColdStartResolver
│  └─ If new process: resolve.resolve() → bootstrap profile
├─ ⚡ OVERHEAD: cache.OptimizationPipeline
│  ├─ pipeline.cache.lookup(pid) → cache hit?
│  ├─ If miss: check delta via get_delta()
│  └─ If large delta: full recompute
├─ 🐌 LEARNING: continuity.LearningAccelerator
│  ├─ apply_continuity_update() → EWMA with constraints
│  └─ get_learning_status() → update phase/progress
├─ Score and decide (EXISTING)
├─ Cache store: pipeline.record_computation()
└─ Cleanup: optimizer.cleanup(), accelerator.cleanup()
```

---

## 📈 Performance Targets

### Cold Start ✓
- Expected accuracy: **80–85%**
- Elimination of blind allocation: **✓**
- System stability improvement: **Immediate**

### Overhead ✓
- 10 processes: **0.01%** (was 0.3%)
- 100 processes: **0.1%** (was 3%)
- 1000 processes: **1%** (was 30%)
- **Overall reduction: ~97%**

### Learning ✓
- Convergence time: **30–90 seconds**
- Baseline: **Minutes**
- **Speed-up: 3–10x**

---

## 🎛️ Configuration Checklist

### In `engine.__init__`:
```python
self.cold_start = ColdStartResolver()              # ✓ Integrated
self.optimizer = OptimizationPipeline(...)         # ✓ Integrated
self.accelerator = LearningAccelerator()           # ✓ Integrated
```

### In `engine._process_tick`:
```python
# Cold start
if profile.observation_count == 1:
    profile = self.cold_start.resolve(...)         # ✓ Called

# Cache check
cached = self.optimizer.cache.lookup(pid)          # ✓ Called

# EWMA continuity
profile = self.accelerator.apply_continuity_update(...) # ✓ Called

# Store in cache
self.optimizer.cache.store(...)                    # ✓ Called
```

### In models:
```python
class BehaviorProfile:
    bootstrapped: bool                             # ✓ Added
    bootstrap_confidence: float                    # ✓ Added
    learning_phase: str                            # ✓ Added
    convergence_progress: float                    # ✓ Added
```

---

## 🔍 Debugging Tips

### Check Cold Start Status:
```python
for pid, profile in engine._profiles.items():
    if profile.observation_count == 1:
        print(f"{profile.name}: bootstrapped={profile.bootstrapped}, "
              f"confidence={profile.bootstrap_confidence:.2f}")
```

### Monitor Cache Performance:
```python
stats = engine.optimizer.get_stats()
print(f"Hits: {stats['hits']}, Misses: {stats['misses']}")
print(f"Hit rate: {stats['hits']/(stats['hits']+stats['misses']):.1%}")
```

### Track Learning Progress:
```python
for pid, profile in engine._profiles.items():
    status = engine.accelerator.get_learning_status(pid)
    print(f"{profile.name}: phase={status['phase']}, "
          f"progress={status['progress']:.1%}, "
          f"age={status['age_seconds']:.0f}s")
```

### Get Full Diagnostics:
```python
diag = engine.get_hurdle_diagnostics()
print(f"Cold Start: {diag['hurdles']['cold_start']['bootstrap_percentage']}% bootstrapped")
print(f"Overhead: {diag['hurdles']['overhead_reduction']['cache_hit_rate']:.1%} cache hit rate")
print(f"Learning: {diag['hurdles']['learning_acceleration']['learning_phases']}")
```

---

## 📋 Files Modified/Created

### Created (NEW):
- `iaris/similarity.py` — Cold start similarity matching
- `iaris/cache.py` — Overhead reduction pipeline
- `iaris/continuity.py` — Learning acceleration engine
- `iaris/diagnostics.py` — Health monitoring & diagnostics

### Modified:
- `iaris/models.py` — Added bootstrap & learning fields
- `iaris/knowledge.py` — Added get_all_profiles()
- `iaris/engine.py` — Main integration & diagnostics methods

### Documentation:
- `IMPLEMENTATION_GUIDE.md` — Comprehensive implementation guide
- This file — Quick reference

---

## ⚠️ Common Pitfalls

1. **Understanding Confidence:** Bootstrap confidence is 0.6–0.9 typical. It's not a guarantee, but a strong hint.

2. **Cache TTL Trade-off:** Lower TTL = more cache misses but fresher data. Higher TTL = stale data risk.

3. **Learning Phase Timing:** Phases are time-based heuristics. Highly variable processes may not follow expected timeline.

4. **Memory Usage:** With max_cache_size=10000 and many processes, consider reducing cache size on resource-constrained systems.

5. **Bootstrap Accuracy:** Requires at least 10 well-learned profiles in knowledge base. Cold start is ineffective with empty knowledge base.

---

## 🚀 Future Enhancements

- [ ] Adaptive alpha based on workload stability
- [ ] Multi-model bootstrap (ensemble of similar processes)
- [ ] Hierarchical caching for very large process counts
- [ ] Predictive cache pre-warming
- [ ] Machine learning for spike detection instead of statistical approach

---

## 📞 Implementation Contact Points

**Integration Questions:**
- Engine integration: Check `engine._process_tick()` line 130-260
- Cache behavior: Check `cache.OptimizationPipeline` class
- Learning curves: Check `continuity.EWMAContinuityEngine` class
- Diagnostics: Check `diagnostics.ThreeHurdleDiagnosticsCollector`

**Tuning Parameters:**
- Similarity weights: `similarity.SimilarityMatcher.__init__`
- Cache policy: `cache.CachingLayer.__init__`
- EWMA settings: `continuity.ContinuityMetrics`
