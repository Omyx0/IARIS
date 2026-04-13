# IARIS — Intent-Aware Adaptive Resource Intelligence System

## What This Is

IARIS is a behavior-driven, learning-based framework for intelligent resource allocation across computing systems. It replaces static priority scheduling with dynamic intent inference — observing process behavior, learning patterns over time, and allocating CPU, memory, I/O, and network resources based on context and impact rather than fixed rules. It targets both Windows (native) and Linux (WSL) environments, with a CLI dashboard and web-based visual interface.

## Core Value

Allocate resources based on observed behavior, context, and system-wide impact — not fixed rules — and explain every decision transparently.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Process monitoring engine using psutil (cross-platform Windows + Linux)
- [ ] Behavior detection system (CPU hog, latency-sensitive, bursty, blocking patterns)
- [ ] Scoring/decision engine with configurable allocation formula
- [ ] EWMA-based learning system for behavior profiling
- [ ] Behavior signature generation and knowledge base storage
- [ ] System state model (Stable / Pressure / Critical) with adaptive responses
- [ ] Workload abstraction (group related processes into logical workloads)
- [ ] Reasoning layer that explains allocation decisions in natural language
- [ ] Cold-start support via JSON recipe files
- [ ] Dummy/synthetic process generator for development and demo
- [ ] Terminal CLI dashboard (system state, workloads, timeline, reasoning)
- [ ] Web dashboard (React frontend + FastAPI backend) with graphs and visual demo
- [ ] REST API for communication between engine and web dashboard
- [ ] Demo flow: baseline → heavy workload → degradation → IARIS → improvement → explain

### Out of Scope

- Distributed/cross-node balancing — future phase, not v1
- Real process control (nice/renice/cpulimit/kill) — deferred to post-v1 after dummy validation
- Network bandwidth shaping — too OS-specific for v1
- GPU resource management — out of scope entirely
- Production deployment hardening — this is a hackathon demo

## Context

- **Timeline**: 1-week hackathon deadline
- **Platform**: Windows native + WSL/Linux dual support via psutil abstraction
- **Development approach**: Dummy processes first to validate system behavior, real process control added later
- **Architecture**: 4-layer system (Execution → Coordination → Learning → Reasoning)
- **Learning model**: EWMA with α=0.3 (newScore = 0.3 × observation + 0.7 × oldScore)
- **Sampling**: 1-second intervals targeting <0.3% CPU overhead
- **Storage**: In-memory dictionaries + SQLite for persistence
- **UI duality**: CLI for system-level feel, web dashboard for visual demos and graphs
- **Demo focus**: Convincing simulation with synthetic workloads that shows clear before/after improvement

## Constraints

- **Timeline**: 1 week — must be demo-ready by end of week
- **Platform**: Must work on Windows natively and on Linux/WSL
- **Overhead**: Engine must consume <0.3% CPU with 1-second sampling
- **Dependencies**: Python ecosystem only (psutil, FastAPI, SQLite) — no heavy frameworks
- **Process control**: v1 uses dummy processes only; real process control deferred

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python + psutil as core engine | Cross-platform process monitoring, mature library | — Pending |
| Dummy processes for v1 | Validate system logic before touching real OS controls | — Pending |
| EWMA (α=0.3) for learning | Industry-standard exponential smoothing, tunable, lightweight | — Pending |
| CLI + Web dual UI | CLI shows system-level cred, web shows visual impact for demos | — Pending |
| FastAPI for backend API | Async, fast, auto-docs, Python-native | — Pending |
| React for web dashboard | Rich component ecosystem, good for real-time data viz | — Pending |
| SQLite for persistence | Zero-config, file-based, perfect for hackathon scope | — Pending |
| In-memory + SQLite hybrid | Hot data in-memory for speed, SQLite for cross-session persistence | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-13 after initialization*
