"""
IARIS TUI Dashboard — Improved Textual Terminal UI

Layout:
  ┌─────────────────────────────────────────────────────────────┐
  │  Header                                                     │
  ├──────────────────────┬──────────────────────────────────────┤
  │  SIDEBAR (fixed 22)  │  MAIN (TabbedContent)                │
  │  • System state      │  Tab 1 – Processes  (DataTable)      │
  │  • CPU / MEM bars    │  Tab 2 – Decisions  (scrollable)     │
  │  • I/O + NET rates   │  Tab 3 – Hurdles    (diagnostics)    │
  │  • Dummy status      │  Tab 4 – Workloads                   │
  └──────────────────────┴──────────────────────────────────────┘
  │  Footer: bindings                                           │
  └─────────────────────────────────────────────────────────────┘

Key bindings:  q=Quit  d=Spawn Demo  x=Stop All  r=Refresh  1-4=Tab
"""

from __future__ import annotations

import time
from typing import Optional

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, ScrollableContainer, Vertical
from textual.reactive import reactive
from textual.widgets import (
    DataTable,
    Footer,
    Header,
    Label,
    Static,
    TabbedContent,
    TabPane,
)
from rich.text import Text
from rich.panel import Panel

from iaris.engine import IARISEngine
from iaris.models import SystemState, BehaviorType, AllocationAction


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _ascii_bar(value: float, width: int = 12) -> str:
    """Return a simple ASCII progress bar like [####------] 42.1%"""
    filled = min(width, int(value / 100 * width))
    bar = "#" * filled + "-" * (width - filled)
    return f"[{bar}] {value:4.1f}%"


def _color_for_pct(pct: float) -> str:
    if pct < 60:
        return "bold green"
    elif pct < 85:
        return "bold yellow"
    return "bold red"


def _state_style(state: SystemState) -> str:
    return {
        SystemState.STABLE: "bold white on dark_green",
        SystemState.PRESSURE: "bold white on dark_orange3",
        SystemState.CRITICAL: "bold white on red",
    }.get(state, "white")


def _behavior_color(btype: BehaviorType) -> str:
    return {
        BehaviorType.CPU_HOG:          "red",
        BehaviorType.LATENCY_SENSITIVE:"bright_green",
        BehaviorType.BURSTY:           "yellow",
        BehaviorType.BLOCKING:         "magenta",
        BehaviorType.MEMORY_HEAVY:     "cyan",
        BehaviorType.IDLE:             "dim",
        BehaviorType.UNKNOWN:          "white",
    }.get(btype, "white")


def _score_color(score: float) -> str:
    if score >= 0.6:
        return "bright_green"
    elif score >= 0.35:
        return "yellow"
    return "red"


def _action_style(action: AllocationAction) -> str:
    return {
        AllocationAction.BOOST:    "bold bright_green",
        AllocationAction.MAINTAIN: "white",
        AllocationAction.THROTTLE: "bold yellow",
        AllocationAction.PAUSE:    "bold red",
    }.get(action, "white")


def _phase_color(phase: str) -> str:
    return {
        "bootstrap":  "cyan",
        "adaptation": "yellow",
        "stable":     "bright_green",
    }.get(phase, "white")


# ─── Sidebar Widget ───────────────────────────────────────────────────────────

class SidebarPanel(Static):
    """
    Left sidebar: system metrics + dummy process status.
    Replaces and merges the old SystemPanel + DummyPanel into one cohesive widget.
    """

    def render(self) -> Panel:  # type: ignore[override]
        app: IARISDashboard = self.app  # type: ignore
        sys = app.engine.system
        dummies = app.engine.simulator.get_status()

        txt = Text()

        # ── System State badge ──────────────────────────────────────────────
        txt.append("  STATE  ", style=_state_style(sys.state))
        txt.append(f"  {sys.behavior.value.upper()}\n\n", style="dim")

        # ── CPU ─────────────────────────────────────────────────────────────
        txt.append("CPU  ", style="bold")
        txt.append(_ascii_bar(sys.cpu_percent), style=_color_for_pct(sys.cpu_percent))
        txt.append(f"  {sys.cpu_count} cores\n", style="dim")

        # ── Memory ──────────────────────────────────────────────────────────
        txt.append("MEM  ", style="bold")
        txt.append(_ascii_bar(sys.memory_percent), style=_color_for_pct(sys.memory_percent))
        txt.append(f"  {sys.memory_available_gb:.1f} GB free\n", style="dim")

        # ── Disk I/O ────────────────────────────────────────────────────────
        txt.append("\nDISK ", style="bold")
        txt.append(f"R {sys.disk_io_read_rate/1024:6.0f} KB/s  ", style="cyan")
        txt.append(f"W {sys.disk_io_write_rate/1024:6.0f} KB/s\n", style="magenta")

        # ── Network ─────────────────────────────────────────────────────────
        txt.append("NET  ", style="bold")
        txt.append(f"↑ {sys.net_io_send_rate/1024:6.0f} KB/s  ", style="cyan")
        txt.append(f"↓ {sys.net_io_recv_rate/1024:6.0f} KB/s\n", style="magenta")

        # ── Process count ───────────────────────────────────────────────────
        txt.append(f"\nProcs  ", style="bold")
        txt.append(f"{sys.process_count}\n", style="bright_white")

        # ── Dummy processes ─────────────────────────────────────────────────
        txt.append("\n─── Dummy Procs ───\n", style="dim")
        if dummies:
            for d in dummies:
                dot = "●" if d["is_alive"] else "✗"
                col = "bright_green" if d["is_alive"] else "red"
                txt.append(f" {dot} ", style=col)
                txt.append(f"{d['behavior_type']}", style="bold")
                txt.append(f"  {d['uptime_seconds']:.0f}s\n", style="dim")
        else:
            txt.append(" (none running)\n", style="dim italic")

        # ── Key hint ────────────────────────────────────────────────────────
        txt.append("\n─── Keys ──────────\n", style="dim")
        hints = [
            ("d", "Spawn demo"),
            ("x", "Stop all"),
            ("r", "Refresh"),
            ("1-4", "Switch tab"),
            ("q", "Quit"),
        ]
        for key, desc in hints:
            txt.append(f" {key:>3}  ", style="bold cyan")
            txt.append(f"{desc}\n", style="dim")

        return Panel(txt, title="⚙ System", border_style="cyan", padding=(0, 1))


# ─── Tab 1: Processes (DataTable) ─────────────────────────────────────────────

PROCESS_COLS = ("PID", "Name", "Type", "Phase", "CPU%", "MEM%", "Score", "Action")


class ProcessesTab(Vertical):
    """Process list using Textual DataTable for scroll + keyboard nav."""

    def compose(self) -> ComposeResult:
        tbl = DataTable(id="proc-table", cursor_type="row", zebra_stripes=True)
        for col in PROCESS_COLS:
            tbl.add_column(col, key=col)
        yield tbl

    def refresh_data(self) -> None:
        app: IARISDashboard = self.app  # type: ignore
        tbl: DataTable = self.query_one("#proc-table", DataTable)

        profiles = sorted(
            app.engine.profiles.values(),
            key=lambda p: p.avg_cpu,
            reverse=True,
        )[:50]

        # Get most recent decision per PID for the Action column
        recent_actions: dict[int, AllocationAction] = {}
        for dec in reversed(app.engine.decisions):
            if dec.pid not in recent_actions:
                recent_actions[dec.pid] = dec.action

        tbl.clear()
        for p in profiles:
            bcolor = _behavior_color(p.behavior_type)
            scolor = _score_color(p.allocation_score)
            pcolor = _phase_color(p.learning_phase)
            action = recent_actions.get(p.pid, AllocationAction.MAINTAIN)
            acolor = _action_style(action)

            tbl.add_row(
                str(p.pid),
                p.name[:24],
                Text(p.behavior_type.value, style=bcolor),
                Text(p.learning_phase[:10], style=pcolor),
                f"{p.avg_cpu:5.1f}",
                f"{p.avg_memory:5.1f}",
                Text(f"{p.allocation_score:.3f}", style=scolor),
                Text(action.value, style=acolor),
            )


# ─── Tab 2: Decisions (scrollable) ────────────────────────────────────────────

class DecisionsTab(Vertical):
    """Scrollable allocation decisions — shows 30 most recent."""

    def compose(self) -> ComposeResult:
        yield ScrollableContainer(Static(id="decisions-content"), id="decisions-scroll")

    def refresh_data(self) -> None:
        app: IARISDashboard = self.app  # type: ignore
        decisions = app.engine.decisions[-30:]   # engine stores 200, show 30

        content: Static = self.query_one("#decisions-content", Static)

        txt = Text()
        if not decisions:
            txt.append("No decisions yet — observing...\n", style="dim italic")
        else:
            for dec in reversed(decisions):                 # newest first
                ts = time.strftime("%H:%M:%S", time.localtime(dec.timestamp))
                astyle = _action_style(dec.action)
                bcolor = _behavior_color(dec.behavior_type)

                txt.append(f"  {ts}  ", style="dim")
                txt.append(f"[{dec.action.value:>8}] ", style=astyle)
                txt.append(f"{dec.process_name[:22]:<22} ", style="bold")
                txt.append(f"({dec.behavior_type.value})\n", style=bcolor)
                # Reason on a second line, indented
                reason = dec.reason[:110] + ("…" if len(dec.reason) > 110 else "")
                txt.append(f"  {'':>9}  {reason}\n", style="dim")
                # Score
                scolor = _score_color(dec.score)
                txt.append(f"  {'':>9}  score={dec.score:.3f}  state={dec.system_state.value}\n\n",
                            style=scolor)

        content.update(
            Panel(txt, title=f"🧠 Recent Decisions ({len(decisions)})", border_style="yellow")
        )


# ─── Tab 3: Hurdles & Diagnostics (NEW) ───────────────────────────────────────

class HurdlesTab(Vertical):
    """
    Real-time Three-Hurdle Solution diagnostics.
    Wired to engine.get_hurdle_diagnostics() — no new backend code required.
    """

    def compose(self) -> ComposeResult:
        yield Static(id="hurdles-content")

    def refresh_data(self) -> None:
        app: IARISDashboard = self.app  # type: ignore
        diag = app.engine.get_hurdle_diagnostics()
        hurdles = diag["hurdles"]
        metrics = diag["metrics"]

        cs   = hurdles["cold_start"]
        oh   = hurdles["overhead_reduction"]
        la   = hurdles["learning_acceleration"]
        phases = la["learning_phases"]

        # Cache hit bar
        hit_rate = oh["cache_hit_rate"]
        hit_pct  = hit_rate * 100

        txt = Text()

        # ── Header summary ───────────────────────────────────────────────────
        txt.append("  Three-Hurdle Solution Framework — Live Diagnostics\n\n",
                   style="bold bright_white")
        txt.append(f"  Tick #{metrics['tick_count']:,}   "
                   f"Processes: {metrics['total_processes']}   "
                   f"Decisions: {metrics['total_decisions']}\n\n",
                   style="dim")

        # ═══ Hurdle 1: Cold Start ════════════════════════════════════════════
        txt.append("  🥶  HURDLE 1 — Cold Start Resolution\n", style="bold cyan")
        txt.append("  ─────────────────────────────────────────────────────\n", style="dim")
        txt.append("  Algorithm : ", style="dim")
        txt.append("Similarity Matching\n", style="cyan")
        txt.append("  Bootstrapped : ", style="dim")
        txt.append(f"{cs['processes_bootstrapped']} processes  ({cs['bootstrap_percentage']}%)\n",
                   style="bold bright_cyan")
        txt.append("  Est. Accuracy: ", style="dim")
        txt.append(f"{cs['expected_initial_accuracy']}\n\n", style="bright_cyan")

        # ═══ Hurdle 2: Overhead ══════════════════════════════════════════════
        txt.append("  ⚡  HURDLE 2 — Overhead Reduction\n", style="bold green")
        txt.append("  ─────────────────────────────────────────────────────\n", style="dim")
        txt.append("  Algorithm : ", style="dim")
        txt.append("v4.0 Optimization Pipeline\n", style="green")

        # Cache hit bar
        hit_bar_filled = min(20, int(hit_pct / 5))
        hit_bar = "█" * hit_bar_filled + "░" * (20 - hit_bar_filled)
        hit_color = "bold bright_green" if hit_pct >= 80 else "bold yellow"
        txt.append("  Cache Hit  : ", style="dim")
        txt.append(f"[{hit_bar}] {hit_pct:5.1f}%\n", style=hit_color)

        txt.append("  Hits / Misses  : ", style="dim")
        txt.append(f"{oh['cache_hits']:,}", style="bright_green")
        txt.append(" / ", style="dim")
        txt.append(f"{oh['cache_misses']:,}\n", style="red")

        txt.append("  Full Recomputes: ", style="dim")
        txt.append(f"{oh['full_recomputes']:,}\n", style="yellow")
        txt.append("  Delta Updates  : ", style="dim")
        txt.append(f"{oh['delta_updates']:,}\n", style="bright_green")
        txt.append("  Evictions      : ", style="dim")
        txt.append(f"{oh['cache_evictions']:,}\n", style="dim")
        txt.append("  Expected CPU   : ", style="dim")
        txt.append(f"{oh['expected_cpu_overhead']}\n\n", style="bright_green")

        # ═══ Hurdle 3: Learning ══════════════════════════════════════════════
        txt.append("  🐌  HURDLE 3 — Learning Acceleration\n", style="bold magenta")
        txt.append("  ─────────────────────────────────────────────────────\n", style="dim")
        txt.append("  Algorithm : ", style="dim")
        txt.append("EWMA Continuity Engine\n", style="magenta")

        bs   = phases["bootstrap"]
        ad   = phases["adaptation"]
        st   = phases["stable"]
        total_procs = max(bs + ad + st, 1)

        for phase_name, count, color in [
            ("Bootstrap ", bs, "cyan"),
            ("Adaptation", ad, "yellow"),
            ("Stable    ", st, "bright_green"),
        ]:
            bar_w = 16
            filled = min(bar_w, int(count / total_procs * bar_w))
            bar = "█" * filled + "░" * (bar_w - filled)
            txt.append(f"  {phase_name}: ", style="dim")
            txt.append(f"[{bar}] {count:>4} procs\n", style=f"bold {color}")

        txt.append("\n  EWMA Alpha (warmup) : ", style="dim")
        txt.append(f"α = {la['alpha_warmup']:.2f}\n", style="magenta")
        txt.append("  EWMA Alpha (steady) : ", style="dim")
        txt.append(f"α = {la['alpha_steady']:.2f}\n", style="magenta")
        txt.append("  Convergence Time    : ", style="dim")
        txt.append(f"{la['expected_convergence_time']}\n", style="bold magenta")

        content: Static = self.query_one("#hurdles-content", Static)
        content.update(
            Panel(txt, title="🔬 Three-Hurdle Diagnostics", border_style="bright_magenta")
        )


# ─── Tab 4: Workloads ─────────────────────────────────────────────────────────

class WorkloadsTab(Vertical):
    """Workload groups with enriched mini-bars and member PIDs."""

    def compose(self) -> ComposeResult:
        yield Static(id="workloads-content")

    def refresh_data(self) -> None:
        app: IARISDashboard = self.app  # type: ignore
        workloads = app.engine.workload.get_status()

        txt = Text()
        has_active = any(wg["member_count"] > 0 for wg in workloads)

        if not has_active:
            txt.append("  No processes matched any workload group yet.\n\n", style="dim italic")
            txt.append("  Spawn dummy processes (press 'd') to see workload activity.\n",
                       style="dim")
        else:
            for wg in workloads:
                members = wg["member_count"]
                if members > 0:
                    txt.append(f"\n  ● {wg['name']}", style="bold bright_white")
                    txt.append(f"  (priority {wg['priority']:.1f})\n", style="dim")
                    txt.append(f"  {wg['description']}\n", style="dim italic")
                    txt.append("  Members : ", style="dim")
                    txt.append(f"{members} processes\n", style="bold")

                    # CPU mini-bar
                    cpu_pct = min(100, wg["total_cpu"])
                    cpu_bar = "█" * int(cpu_pct / 5) + "░" * (20 - int(cpu_pct / 5))
                    txt.append("  CPU     : ", style="dim")
                    txt.append(f"[{cpu_bar}] {wg['total_cpu']:.1f}%\n",
                               style=_color_for_pct(cpu_pct))

                    # MEM mini-bar
                    mem_pct = min(100, wg["total_memory"])
                    mem_bar = "█" * int(mem_pct / 5) + "░" * (20 - int(mem_pct / 5))
                    txt.append("  Memory  : ", style="dim")
                    txt.append(f"[{mem_bar}] {wg['total_memory']:.1f}%\n",
                               style=_color_for_pct(mem_pct))

                    # Member PIDs
                    if wg["member_pids"]:
                        pid_str = ", ".join(str(p) for p in wg["member_pids"][:10])
                        if len(wg["member_pids"]) > 10:
                            pid_str += f"  (+{len(wg['member_pids']) - 10} more)"
                        txt.append("  PIDs    : ", style="dim")
                        txt.append(f"{pid_str}\n", style="cyan")
                else:
                    txt.append(f"\n  ○ {wg['name']}", style="dim")
                    txt.append(f"  (empty)\n", style="dim")

        content: Static = self.query_one("#workloads-content", Static)
        content.update(
            Panel(txt, title="🔗 Workloads", border_style="blue")
        )


# ─── Main Dashboard ───────────────────────────────────────────────────────────

class IARISDashboard(App):
    """IARIS Terminal Dashboard — Real-time system intelligence."""

    TITLE = "IARIS — Intent-Aware Adaptive Resource Intelligence"

    CSS = """
    /* ─── Layout ──────────────────────────────────────────────────────── */
    Screen {
        layout: horizontal;
        background: $background;
    }

    #sidebar {
        width: 34;
        height: 100%;
        dock: left;
        padding: 0;
    }

    #main {
        width: 1fr;
        height: 100%;
        padding: 0 1;
    }

    /* ─── Sidebar ──────────────────────────────────────────────────────── */
    SidebarPanel {
        height: 100%;
        overflow-y: auto;
    }

    /* ─── Tabs ─────────────────────────────────────────────────────────── */
    TabbedContent {
        height: 1fr;
    }

    TabPane {
        padding: 0;
        height: 100%;
    }

    /* ─── Process DataTable ─────────────────────────────────────────────── */
    ProcessesTab {
        height: 100%;
    }

    DataTable {
        height: 1fr;
    }

    /* ─── Scrollable decisions ──────────────────────────────────────────── */
    DecisionsTab {
        height: 100%;
    }

    #decisions-scroll {
        height: 1fr;
        overflow-y: scroll;
    }

    /* ─── Hurdles & Workloads ───────────────────────────────────────────── */
    HurdlesTab {
        height: 100%;
        overflow-y: auto;
    }

    WorkloadsTab {
        height: 100%;
        overflow-y: auto;
    }
    """

    BINDINGS = [
        Binding("q",  "quit",         "Quit",       priority=True),
        Binding("d",  "spawn_demo",   "Spawn Demo"),
        Binding("x",  "stop_all",     "Stop All"),
        Binding("r",  "force_refresh","Refresh"),
        Binding("1",  "tab_1",        "Processes"),
        Binding("2",  "tab_2",        "Decisions"),
        Binding("3",  "tab_3",        "Hurdles"),
        Binding("4",  "tab_4",        "Workloads"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.engine = IARISEngine()

    # ── Composition ───────────────────────────────────────────────────────────

    def compose(self) -> ComposeResult:
        yield Header()

        with Horizontal():
            with Vertical(id="sidebar"):
                yield SidebarPanel(id="sidebar-panel")

            with Vertical(id="main"):
                with TabbedContent(id="tabs"):
                    with TabPane("📊 Processes", id="tab-processes"):
                        yield ProcessesTab(id="processes-tab")
                    with TabPane("🧠 Decisions", id="tab-decisions"):
                        yield DecisionsTab(id="decisions-tab")
                    with TabPane("🔬 Hurdles", id="tab-hurdles"):
                        yield HurdlesTab(id="hurdles-tab")
                    with TabPane("🔗 Workloads", id="tab-workloads"):
                        yield WorkloadsTab(id="workloads-tab")

        yield Footer()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def on_mount(self) -> None:
        """Initialize engine and start 1-second refresh cycle."""
        self.engine.initialize()
        # Initial sample so panels don't show empty on first render
        self.engine.monitor.sample_once()
        self.engine._process_tick(self.engine.system, self.engine.monitor.processes)
        # Populate initial data
        self._refresh_all()
        # Tick every second
        self.set_interval(1.0, self._tick)

    def _tick(self) -> None:
        """Main 1-second tick: sample → process → refresh UI."""
        system, processes = self.engine.monitor.sample_once()
        self.engine._process_tick(system, processes)
        self._refresh_all()

    def _refresh_all(self) -> None:
        """Refresh every panel on the current tick."""
        # Sidebar always visible
        try:
            self.query_one("#sidebar-panel", SidebarPanel).refresh()
        except Exception:
            pass

        # Refresh whichever tabs exist (they always do; Textual keeps them mounted)
        for tab_id, method_name in [
            ("processes-tab",  "refresh_data"),
            ("decisions-tab",  "refresh_data"),
            ("hurdles-tab",    "refresh_data"),
            ("workloads-tab",  "refresh_data"),
        ]:
            try:
                tab = self.query_one(f"#{tab_id}")
                getattr(tab, method_name)()
            except Exception:
                pass

    # ── Actions ───────────────────────────────────────────────────────────────

    def action_spawn_demo(self) -> None:
        self.engine.simulator.spawn_demo_set()
        self._refresh_all()

    def action_stop_all(self) -> None:
        self.engine.simulator.stop_all()
        self._refresh_all()

    def action_force_refresh(self) -> None:
        self._tick()

    def action_tab_1(self) -> None:
        try:
            self.query_one("#tabs", TabbedContent).active = "tab-processes"
        except Exception:
            pass

    def action_tab_2(self) -> None:
        try:
            self.query_one("#tabs", TabbedContent).active = "tab-decisions"
        except Exception:
            pass

    def action_tab_3(self) -> None:
        try:
            self.query_one("#tabs", TabbedContent).active = "tab-hurdles"
        except Exception:
            pass

    def action_tab_4(self) -> None:
        try:
            self.query_one("#tabs", TabbedContent).active = "tab-workloads"
        except Exception:
            pass

    def on_unmount(self) -> None:
        """Cleanup on exit."""
        self.engine.stop()
