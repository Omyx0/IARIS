"""
IARIS TUI Core Test — no dummy process spawning (avoids Windows multiprocessing issue)
"""
import sys
import asyncio
import os

# Force UTF-8 output
sys.stdout.reconfigure(encoding="utf-8")

print("=" * 55)
print("IARIS TUI Core Test")
print("=" * 55)

# ─── 1. Helper functions ─────────────────────────────────────────────────────
print("\n[1/3] Helper functions...")
from iaris.tui import (
    _ascii_bar, _color_for_pct, _state_style,
    _behavior_color, _score_color, _action_style, _phase_color,
)
from iaris.models import SystemState, BehaviorType, AllocationAction

assert "100.0%" in _ascii_bar(100), f"Got: {_ascii_bar(100)!r}"
assert "0.0%"   in _ascii_bar(0),   f"Got: {_ascii_bar(0)!r}"
assert "50.0%"  in _ascii_bar(50),  f"Got: {_ascii_bar(50)!r}"
assert _ascii_bar(0).startswith("[") and _ascii_bar(100).startswith("[")

print(f"  bar( 0%) = {_ascii_bar(0)}")
print(f"  bar(50%) = {_ascii_bar(50)}")
print(f"  bar(100%)= {_ascii_bar(100)}")

assert _color_for_pct(30)  == "bold green"
assert _color_for_pct(70)  == "bold yellow"
assert _color_for_pct(95)  == "bold red"
assert _state_style(SystemState.STABLE)   == "bold white on dark_green"
assert _state_style(SystemState.PRESSURE) == "bold white on dark_orange3"
assert _state_style(SystemState.CRITICAL) == "bold white on red"
assert _behavior_color(BehaviorType.CPU_HOG)           == "red"
assert _behavior_color(BehaviorType.LATENCY_SENSITIVE)  == "bright_green"
assert _score_color(0.8) == "bright_green"
assert _score_color(0.5) == "yellow"
assert _score_color(0.1) == "red"
assert _action_style(AllocationAction.BOOST)    == "bold bright_green"
assert _action_style(AllocationAction.MAINTAIN) == "white"
assert _action_style(AllocationAction.THROTTLE) == "bold yellow"
assert _action_style(AllocationAction.PAUSE)    == "bold red"
assert _phase_color("bootstrap")  == "cyan"
assert _phase_color("adaptation") == "yellow"
assert _phase_color("stable")     == "bright_green"
print("  PASS: all 20+ assertions correct")

# ─── 2. Engine + all TUI data methods ────────────────────────────────────────
print("\n[2/3] Engine + TUI data methods...")
from iaris.engine import IARISEngine

engine = IARISEngine()
engine.initialize()

system, processes = engine.monitor.sample_once()
engine._process_tick(system, processes)

profiles = engine.profiles
print(f"  profiles tracked   : {len(profiles)}")

snap = engine.system
assert hasattr(snap, "cpu_percent")
assert snap.state in list(SystemState)
print(f"  system.cpu_percent : {snap.cpu_percent:.1f}%")
print(f"  system.state       : {snap.state.value}")

decisions = engine.decisions
print(f"  decisions stored   : {len(decisions)}")

# The critical check — hurdle diagnostics (new tab)
diag = engine.get_hurdle_diagnostics()
assert "hurdles" in diag and "metrics" in diag
h = diag["hurdles"]
assert "cold_start"            in h
assert "overhead_reduction"    in h
assert "learning_acceleration" in h

oh = h["overhead_reduction"]
cs = h["cold_start"]
la = h["learning_acceleration"]

assert 0.0 <= oh["cache_hit_rate"] <= 1.0
assert isinstance(cs["processes_bootstrapped"], int)
assert {"bootstrap","adaptation","stable"} == set(la["learning_phases"].keys())

print(f"  cache_hit_rate     : {oh['cache_hit_rate']:.3f}")
print(f"  bootstrapped       : {cs['processes_bootstrapped']}")
print(f"  learning_phases    : {la['learning_phases']}")
print(f"  tick_count         : {diag['metrics']['tick_count']}")

# Second tick to see cache warm up
system2, processes2 = engine.monitor.sample_once()
engine._process_tick(system2, processes2)
diag2 = engine.get_hurdle_diagnostics()
print(f"  cache_hit after 2  : {diag2['hurdles']['overhead_reduction']['cache_hit_rate']:.3f}")

# Workloads
wl = engine.workload.get_status()
assert isinstance(wl, list)
for wg in wl:
    assert {"name","priority","member_count","total_cpu","total_memory","member_pids"} <= set(wg.keys())
print(f"  workload groups    : {len(wl)} ({[w['name'] for w in wl]})")

# Simulator (no spawn)
sim = engine.simulator.get_status()
assert isinstance(sim, list)
print(f"  simulator dummies  : {len(sim)} (none spawned)")

print("  PASS: all engine data methods verified")

# ─── 3. Textual headless compose ─────────────────────────────────────────────
print("\n[3/3] Textual headless compose test...")
from iaris.tui import IARISDashboard
from textual.widgets import DataTable, TabbedContent

async def run_headless():
    app = IARISDashboard()
    async with app.run_test(headless=True, size=(200, 50)) as pilot:
        await pilot.pause(1.0)  # let on_mount + initial _tick fire

        # Check sidebar
        sidebar = app.query_one("#sidebar-panel")
        assert sidebar is not None
        print("  sidebar-panel     : mounted OK")

        # Check DataTable
        dt = app.query_one("#proc-table", DataTable)
        assert dt is not None
        row_count = dt.row_count
        print(f"  proc-table rows   : {row_count}")

        # Check TabbedContent
        tabs = app.query_one("#tabs", TabbedContent)
        assert tabs is not None
        print("  TabbedContent     : mounted OK")

        # Check all 4 panes
        for tab_id in ["tab-processes","tab-decisions","tab-hurdles","tab-workloads"]:
            pane = app.query_one(f"#{tab_id}")
            assert pane is not None, f"Missing #{tab_id}"
        print("  4 tab panes       : all present")

        # Tab switch key bindings
        for key in ["1","2","3","4","1"]:
            await pilot.press(key)
            await pilot.pause(0.05)
        print("  tab keys 1-4      : no crash")

        # Force refresh
        await pilot.press("r")
        await pilot.pause(0.1)
        print("  refresh key 'r'   : no crash")

        # Quit cleanly
        await pilot.press("q")
        await pilot.pause(0.05)

    print("  App exited cleanly")

asyncio.run(run_headless())

print("\n" + "=" * 55)
print("ALL TESTS PASSED")
print("=" * 55)
