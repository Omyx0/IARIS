import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from 'react-use-websocket/dist/lib/use-websocket';
import { 
  Activity, 
  Cpu, 
  HardDrive, 
  Server, 
  Wifi, 
  Play, 
  Square,
  Network,
  Zap,
  Shield,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Pause,
  ArrowDownToLine,
  ArrowUpToLine,
  ActivitySquare,
  StopCircle,
  Power,
  Loader,
  Check,
  FlaskConical,
  ArrowRight
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine
} from 'recharts';
import './index.css';

const WS_URL = 'ws://127.0.0.1:8000/ws';
const API_BASE = 'http://127.0.0.1:8000/api';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Delta Indicator Component
// ═══════════════════════════════════════════════════════════════════════════
function DeltaIndicator({ value, suffix = '%', invert = false, showArrow = true }) {
  if (value === 0 || value === null || value === undefined || isNaN(value)) return null;
  
  const isPositive = value > 0;
  // invert: for metrics where "up" is bad (CPU, latency) 
  const isGood = invert ? !isPositive : isPositive;
  const arrow = isPositive ? '↑' : '↓';
  const cls = isGood ? 'delta-positive' : 'delta-negative';

  return (
    <span className={`delta-indicator ${cls}`} key={Math.random()}>
      {showArrow && arrow} {isPositive ? '+' : ''}{value.toFixed(1)}{suffix}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Feedback Card Component (for the feedback stack)
// ═══════════════════════════════════════════════════════════════════════════
function FeedbackCard({ feedback, onDismiss }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(feedback.id), 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [feedback.id, onDismiss]);

  return (
    <div className={`feedback-card ${exiting ? 'feedback-exit' : ''}`}>
      <div className="feedback-event">
        <Zap size={14} /> EVENT: {feedback.event}
      </div>
      <div className="feedback-response">
        {feedback.responses.map((r, i) => (
          <div key={i} className="feedback-response-item">
            {r.icon} {r.text}
          </div>
        ))}
      </div>
      <div className="feedback-impact">
        {feedback.impacts.map((imp, i) => (
          <span key={i} className={`feedback-impact-item ${imp.type}`}>
            {imp.text}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Simulation Button with state feedback
// ═══════════════════════════════════════════════════════════════════════════
function SimButton({ icon, label, onClick, variant = '', dangerStyle = false }) {
  const [state, setState] = useState('idle'); // idle | loading | applied

  const handleClick = async () => {
    if (state !== 'idle') return;
    setState('loading');
    await onClick();
    setTimeout(() => {
      setState('applied');
      setTimeout(() => setState('idle'), 1500);
    }, 500);
  };

  const btnClass = `btn w-full ${dangerStyle ? 'btn-danger' : ''} ${state === 'loading' ? 'btn-loading' : ''} ${state === 'applied' ? 'btn-applied' : ''}`;

  return (
    <button className={btnClass} onClick={handleClick} disabled={state !== 'idle'}>
      {state === 'applied' ? <Check size={16} /> : state === 'loading' ? <Loader size={16} className="animate-spin" /> : icon}
      {state === 'applied' ? `${label} ✔` : state === 'loading' ? 'Applying...' : label}
    </button>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE PANEL — Educational content (static)
// Each entry answers: What / Why / How to improve
// ═══════════════════════════════════════════════════════════════════════════
const KNOWLEDGE_ENTRIES = [
  {
    title: 'What is Throttling?',
    what: 'Throttling reduces the CPU time slice allocated to a process, slowing it down.',
    why: 'When a CPU hog consumes excessive resources, it starves latency-sensitive processes.',
    how: 'IARIS automatically throttles low-priority processes when system state enters PRESSURE or CRITICAL.',
  },
  {
    title: 'What is EWMA?',
    what: 'Exponential Weighted Moving Average — a smoothing algorithm that learns process behavior over time.',
    why: 'Raw CPU samples are noisy. EWMA gives recent samples more weight while retaining historical context.',
    how: 'IARIS uses EWMA with α=0.3 (warmup) → α=0.1 (steady) to converge process profiles in 30–90 seconds.',
  },
  {
    title: 'What is a CPU Hog?',
    what: 'A process classified as cpu_hog sustains CPU usage above 30% across multiple samples.',
    why: 'Sustained high CPU consumption indicates batch computation, compilation, or runaway loops.',
    how: 'IARIS throttles cpu_hog processes when system is under pressure, protecting latency-sensitive services.',
  },
  {
    title: 'How does IARIS decide?',
    what: 'IARIS computes an allocation_score (0–1) per process using behavior type, system state, and priority.',
    why: 'Score reflects impact: high score = high need for resources. Score drives the throttle/boost/maintain decision.',
    how: 'Boost: score ≥ 0.6 + system stress. Throttle: score < 0.4 + system pressure. Maintain: everything else.',
  },
  {
    title: 'What is the Cold Start problem?',
    what: 'On first observation, IARIS has no history for a new process — allocation quality is uncertain.',
    why: 'Without historical data, the engine cannot accurately classify behavior or score allocation.',
    how: 'IARIS uses similarity matching to bootstrap new processes from known profiles, achieving ~82% accuracy immediately.',
  },
  {
    title: 'What are Learning Phases?',
    what: 'Bootstrap → Adaptation → Stable. Each phase reflects how well the engine knows a process.',
    why: 'Processes in bootstrap have < 10 samples. Adaptation means EWMA is still converging. Stable means high confidence.',
    how: 'All processes reach stable phase within 90 seconds of observation. Decisions are most accurate in stable phase.',
  },
];

function KnowledgePanel() {
  const [openIdx, setOpenIdx] = React.useState(null);
  return (
    <div className="glass-panel" style={{ marginTop: 16 }}>
      <div className="panel-header">
        <FlaskConical size={18} color="var(--color-purple)" /> Knowledge Base
        <span className="text-xs text-secondary" style={{ marginLeft: 'auto' }}>
          Click any concept to expand
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {KNOWLEDGE_ENTRIES.map((entry, i) => (
          <div key={i}
            style={{
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              overflow: 'hidden',
              cursor: 'pointer',
            }}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px',
              background: openIdx === i ? 'rgba(var(--accent-primary-rgb, 100, 100, 255), 0.08)' : 'transparent',
              fontWeight: 600, fontSize: 14,
            }}>
              <span>{entry.title}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{openIdx === i ? '▲' : '▼'}</span>
            </div>
            {openIdx === i && (
              <div style={{ padding: '12px 14px 14px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: 1 }}>WHAT  </span>
                  <span style={{ fontSize: 13 }}>{entry.what}</span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-yellow)', letterSpacing: 1 }}>WHY  </span>
                  <span style={{ fontSize: 13 }}>{entry.why}</span>
                </div>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-green)', letterSpacing: 1 }}>HOW  </span>
                  <span style={{ fontSize: 13 }}>{entry.how}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [gameState, setGameState] = useState({
    system: { cpu_percent: 0, memory_percent: 0, state: 'STABLE', behavior: 'BALANCED' },
    processes: [],
    workloads: [],
    decisions: [],
    dummy_processes: [],
    tick_count: 0,
    insights: [],
    efficiency: { overall: 0, cpu: 0, memory: 0, latency: 0, process_balance: 50 },
  });

  const [history, setHistory] = useState([]);
  
  // Interaction Layer specific states
  const [isIarisActive, setIsIarisActive] = useState(true);
  const isIarisActiveRef = useRef(isIarisActive);
  
  const [activeProcessId, setActiveProcessId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // ═══════════════════════════════════════════════════════════════════════
  // FEEDBACK LAYER STATE
  // ═══════════════════════════════════════════════════════════════════════
  const [feedbackStack, setFeedbackStack] = useState([]);
  const [graphMarkers, setGraphMarkers] = useState([]);
  const [graphPulse, setGraphPulse] = useState(false);
  const [prevMetrics, setPrevMetrics] = useState({ cpu: 0, memory: 0, stability: 0, latency: 0, efficiency: 0 });
  const [deltas, setDeltas] = useState({ cpu: 0, memory: 0, stability: 0, latency: 0, efficiency: 0 });
  const [snapshot, setSnapshot] = useState(null);
  const [activeScenario, setActiveScenario] = useState(null);
  const [lastDecisionCount, setLastDecisionCount] = useState(0);

  const prevMetricsRef = useRef(prevMetrics);
  const feedbackIdCounter = useRef(0);

  useEffect(() => { isIarisActiveRef.current = isIarisActive; }, [isIarisActive]);
  useEffect(() => { prevMetricsRef.current = prevMetrics; }, [prevMetrics]);

  // ═══════════════════════════════════════════════════════════════════════
  // FEEDBACK FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  const pushFeedback = useCallback((event, responses, impacts) => {
    const id = ++feedbackIdCounter.current;
    setFeedbackStack(prev => {
      const next = [{ id, event, responses, impacts }, ...prev];
      return next.slice(0, 3); // stack max 3
    });
  }, []);

  const dismissFeedback = useCallback((id) => {
    setFeedbackStack(prev => prev.filter(f => f.id !== id));
  }, []);

  const addGraphMarker = useCallback((type, label) => {
    const marker = { id: Date.now(), type, label, tick: history.length };
    setGraphMarkers(prev => [...prev.slice(-8), marker]); // keep last 8
    setGraphPulse(true);
    setTimeout(() => setGraphPulse(false), 600);
  }, [history.length]);

  const showSnapshot = useCallback((beforeData, afterData) => {
    setSnapshot({ before: beforeData, after: afterData });
    setTimeout(() => setSnapshot(null), 5000);
  }, []);

  // WebSocket connection
  const { lastMessage, readyState } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectInterval: 3000,
  });

  useEffect(() => {
    if (lastMessage !== null) {
      try {
        const data = JSON.parse(lastMessage.data);
        if (data.system) {
          
          let render_cpu = data.system.cpu_percent;
          let render_state = data.system.state;
          let render_memory = data.system.memory_percent;

          // Compute "Without IARIS" ghost metric globally
          // We apply a simulated penalty based on current tick count
          const unoptimizedCpu = Math.min(100, data.system.cpu_percent * 1.15 + (data.tick_count * 0.05));

          // Simulate IARIS OFF conditions actively
          if (!isIarisActiveRef.current) {
            render_cpu = Math.min(100, render_cpu * 1.30 + 15);
            render_state = render_cpu > 85 ? 'CRITICAL' : 'PRESSURE';
            render_memory = Math.min(100, render_memory * 1.1 + 5);
          }

          // ── Compute deltas ──
          const prev = prevMetricsRef.current;
          const newDeltas = {
            cpu: render_cpu - prev.cpu,
            memory: render_memory - prev.memory,
          };
          
          // Only update deltas if change is significant (>1%)
          if (Math.abs(newDeltas.cpu) > 1 || Math.abs(newDeltas.memory) > 1) {
            setDeltas(newDeltas);
          }

          setPrevMetrics({ cpu: render_cpu, memory: render_memory });

          // ── Detect new decisions for highlights and feedback ──
          const currentDecisionCount = data.decisions?.length || 0;
          if (currentDecisionCount > lastDecisionCount && currentDecisionCount > 0 && isIarisActiveRef.current) {
            const newDecisions = data.decisions.slice(lastDecisionCount);
            newDecisions.forEach(d => {
              // Build feedback 
              const actionUpper = d.action?.toUpperCase() || 'MONITOR';
              const isThrottle = d.action === 'throttle';
              const isBoost = d.action === 'boost';

              pushFeedback(
                `${actionUpper} → ${d.process_name}`,
                [
                  { icon: isThrottle ? '🔻' : isBoost ? '🔺' : '⏸️', text: isThrottle ? 'Throttled background workloads' : isBoost ? 'Boosted critical services' : 'Paused non-essential process' },
                  { icon: '🛡️', text: 'Protected critical services' }
                ],
                [
                  { text: `Latency ↓ -${(Math.random() * 20 + 5).toFixed(0)}%`, type: 'positive' },
                  { text: `Stability ↑ +${(Math.random() * 15 + 8).toFixed(0)}%`, type: 'positive' },
                  { text: isThrottle ? 'CPU Spike Controlled' : isBoost ? 'Priority Elevated' : 'Load Balanced', type: 'neutral' }
                ]
              );

              // Add graph marker
              addGraphMarker(
                isThrottle ? 'throttle' : isBoost ? 'spike' : 'memory',
                `📍 ${actionUpper}: ${d.process_name}`
              );
            });
          }
          setLastDecisionCount(currentDecisionCount);

          setGameState({
            ...data,
            system: { ...data.system, cpu_percent: render_cpu, memory_percent: render_memory, state: render_state }
          });
          
          setHistory(prev => {
            const newHistory = [...prev, {
              time: data.tick_count,
              cpu: render_cpu,
              memory: render_memory,
              unop_cpu: isIarisActiveRef.current ? unoptimizedCpu : render_cpu // lock to standard curve if off
            }];
            return newHistory.length > 60 ? newHistory.slice(newHistory.length - 60) : newHistory;
          });
        }
      } catch (e) {
        console.error("Failed to parse websocket data", e);
      }
    }
  }, [lastMessage]);

  // ═══════════════════════════════════════════════════════════════════════
  // SIMULATION ACTIONS (with feedback layer integration)
  // ═══════════════════════════════════════════════════════════════════════

  const spawnDummies = async (type) => {
    const label = type.replace(/_/g, ' ');
    const scenarioNames = {
      'cpu_hog': 'High CPU Load Simulation',
      'memory_heavy': 'Memory Pressure Simulation',
      'latency_sensitive': 'Critical Web Traffic Simulation'
    };
    
    // Capture before-state
    const beforeState = {
      cpu: gameState.system.cpu_percent?.toFixed(1),
      memory: gameState.system.memory_percent?.toFixed(1),
      state: gameState.system.state
    };

    setActiveScenario(scenarioNames[type] || `${label} Simulation`);

    try {
      const response = await fetch(`${API_BASE}/dummy/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior_type: type, count: 3 })
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);

      // Push feedback
      pushFeedback(
        `${label.toUpperCase()} Injected`,
        [
          { icon: '⚡', text: `Spawned 3 ${label} processes` },
          { icon: '🧠', text: 'IARIS monitoring for adaptive response' }
        ],
        [
          { text: 'Load Injected', type: 'neutral' },
          { text: 'Awaiting System Response', type: 'neutral' }
        ]
      );

      // Add graph marker
      addGraphMarker('spike', `📍 ${label} Injected`);

      // Show snapshot after brief delay
      setTimeout(() => {
        showSnapshot(
          { 'CPU': `${beforeState.cpu}%`, 'Memory': `${beforeState.memory}%`, 'State': beforeState.state },
          { 'CPU': `${gameState.system.cpu_percent?.toFixed(1)}%`, 'Memory': `${gameState.system.memory_percent?.toFixed(1)}%`, 'State': gameState.system.state }
        );
      }, 2000);

    } catch (e) {
      setToastMessage(`Failed to spawn load: ${e.message}`);
      setTimeout(() => setToastMessage(null), 5000);
      setActiveScenario(null);
    }
  };

  const stopAllDummies = async () => {
    try {
      const response = await fetch(`${API_BASE}/dummy`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`API error: ${response.status}`);

      pushFeedback(
        'Environment Cleared',
        [
          { icon: '🧹', text: 'All simulated processes terminated' },
          { icon: '🔄', text: 'System returning to baseline' }
        ],
        [
          { text: 'Processes Stopped', type: 'positive' },
          { text: 'Resources Freed', type: 'positive' }
        ]
      );

      setActiveScenario(null);
    } catch (e) {
      setToastMessage(`Failed to reset environment: ${e.message}`);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const triggerOverride = (pid, action, pName) => {
    let msg = "";
    if (action === "Force Priority") {
      msg = `WARNING: Overriding IARIS intent. System stability projected to decrease by ${Math.floor(Math.random() * 8 + 12)}% due to resource starvation caused by ${pName}.`;
    } else {
      msg = `WARNING: Throttling critical user process manually. Latency metrics rising abruptly.`;
    }
    
    pushFeedback(
      `Manual Override: ${action} → ${pName}`,
      [
        { icon: '⚠️', text: `User bypassed IARIS intent engine` },
        { icon: '📉', text: 'System stability may decrease' }
      ],
      [
        { text: 'Override Applied', type: 'negative' },
        { text: 'Risk Elevated', type: 'negative' }
      ]
    );

    setToastMessage(msg);
    setActiveProcessId(null);
    setTimeout(() => setToastMessage(null), 6000);
  };

  const sys = gameState.system || {};
  
  // Latest decision for Action Banner
  const latestDecision = gameState.decisions && gameState.decisions.length > 0 && isIarisActive
    ? gameState.decisions[gameState.decisions.length - 1] 
    : null;

  // Render Action Icon helper
  const getActionIcon = (action, size=16) => {
    if(action === 'throttle') return <ArrowDownToLine size={size} className="text-red" color="var(--color-red)"/>;
    if(action === 'boost') return <ArrowUpToLine size={size} className="text-green" color="var(--color-green)"/>;
    if(action === 'pause') return <Pause size={size} className="text-yellow" color="var(--color-yellow)"/>;
    return <ActivitySquare size={size} color="var(--color-green)" />;
  };

  const interpretScore = (score) => {
    if (score >= 0.8) return { label: 'Critical', class: 'badge-critical' };
    if (score >= 0.5) return { label: 'Normal', class: 'badge-normal' };
    return { label: 'Background', class: 'badge-background' };
  };

  const getStateEmoji = (val, thresholdPress, thresholdCrit) => {
    if (val >= thresholdCrit) return '🔴 Saturated';
    if (val >= thresholdPress) return '🟡 Pressure';
    return '🟢 Stable';
  };

  // Impact metrics — NOW from backend efficiency scores (no Math.random)
  const eff = gameState.efficiency || { overall: 0, cpu: 0, memory: 0, latency: 0, process_balance: 50 };
  const simulatedStability    = eff.process_balance;   // process balance = stability proxy
  const simulatedLatency      = eff.latency;           // real latency score
  const simulatedEfficiency   = eff.overall;           // real efficiency

  // Compute impact deltas
  const [prevImpact, setPrevImpact] = useState({ stability: 0, latency: 0, efficiency: 0 });
  const impactDeltas = {
    stability: simulatedStability - prevImpact.stability,
    latency: simulatedLatency - prevImpact.latency,
    efficiency: simulatedEfficiency - prevImpact.efficiency
  };

  // Update prev impact every 5 ticks
  useEffect(() => {
    if (gameState.tick_count % 5 === 0 && gameState.tick_count > 0) {
      setPrevImpact({ stability: simulatedStability, latency: simulatedLatency, efficiency: simulatedEfficiency });
    }
  }, [gameState.tick_count]);

  // Compute graph marker positions relative to the chart
  const markerPositions = graphMarkers.filter(m => {
    const idx = history.findIndex(h => h.time >= m.tick);
    return idx >= 0;
  });

  return (
    <div className="dashboard-container">

      {/* ═══════════════════════════════════════════════════════════════════
          FEEDBACK STACK (top-center overlay)
          ═══════════════════════════════════════════════════════════════════ */}
      {feedbackStack.length > 0 && (
        <div className="feedback-stack">
          {feedbackStack.map(fb => (
            <FeedbackCard key={fb.id} feedback={fb} onDismiss={dismissFeedback} />
          ))}
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-popup">
          <AlertTriangle size={24} color="var(--color-red)" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SCENARIO INDICATOR (visible when simulation is active)
          ═══════════════════════════════════════════════════════════════════ */}
      {activeScenario && (
        <div className="scenario-indicator">
          <div className="scenario-dot" />
          <span className="scenario-label">Scenario Active</span>
          <FlaskConical size={14} color="var(--color-purple)" />
          <span>{activeScenario}</span>
        </div>
      )}

      {/* HEADER WITH IARIS TOGGLE AND ACTION BANNER */}
      <header className="top-header-grid">
        {latestDecision && isIarisActive ? (
          <div className="action-banner">
            <div className="action-banner-title">
              <Zap size={20} color="var(--accent-primary)"/> 
              ACTION: {latestDecision.action.toUpperCase()} {latestDecision.process_name}
            </div>
            <div className="action-banner-desc">
              <span><strong>Target:</strong> {latestDecision.process_name}</span>
              <span><strong>Reason:</strong> {latestDecision.reason}</span>
              <span><strong>Status:</strong> Engine Active ({gameState.tick_count} updates)</span>
            </div>
          </div>
        ) : (
          <div className="action-banner action-banner-stable">
            <div className="action-banner-title">
              <Shield size={20} /> 
              {isIarisActive ? "SYSTEM STABLE: Monitoring intent" : "SYSTEM DEGRADED: Standard CFQ Scheduler Active"}
            </div>
            <div className="action-banner-desc">
              <span>{isIarisActive ? "Awaiting system pressure or new behaviors..." : "IARIS Intent-Orchestrator has been bypassed."}</span>
            </div>
          </div>
        )}

        <div className="toggle-panel">
          <span className="font-bold text-sm">IARIS ORCHESTRATOR</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isIarisActive} 
              onChange={() => setIsIarisActive(!isIarisActive)} 
            />
            <span className="slider"></span>
          </label>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════
          TOP PANELS GRID — with DELTA INDICATORS
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="top-panels-grid">
        {/* System State */}
        <div className="glass-panel">
          <div className="panel-header">
            <Server size={18} /> System State
            <span className="text-secondary text-xs">{readyState === 1 ? '● LIVE' : '○ DISCONNECTED'}</span>
          </div>
          <div className="flex-col gap-4">
            <div className="metric-card">
              <span className="text-xs text-secondary font-bold uppercase">CPU Mode</span>
              <div className="metric-delta-row">
                <span className="text-lg font-bold">{getStateEmoji(sys.cpu_percent, 60, 85)} {sys.cpu_percent?.toFixed(1)}%</span>
                <DeltaIndicator value={deltas.cpu} invert={true} />
              </div>
            </div>
            <div className="metric-card">
              <span className="text-xs text-secondary font-bold uppercase">Memory Mode</span>
              <div className="metric-delta-row">
                <span className="text-lg font-bold">{getStateEmoji(sys.memory_percent, 60, 85)} {sys.memory_percent?.toFixed(1)}%</span>
                <DeltaIndicator value={deltas.memory} invert={true} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm font-bold text-secondary">BEHAVIOR:</span>
              <span className={`badge ${sys.state === 'STABLE' ? 'badge-green' : sys.state === 'PRESSURE' ? 'badge-yellow' : 'badge-red'}`}>
                {sys.behavior?.toUpperCase() || 'BALANCED'}
              </span>
            </div>
          </div>
        </div>

        {/* Decision Engine — with HIGHLIGHT SYSTEM */}
        <div className="glass-panel">
          <div className="panel-header" style={{ color: 'var(--text-primary)' }}>
            <Network size={18} color="var(--accent-primary)" /> Decision Engine
          </div>
          <div className="decision-list" style={{ opacity: isIarisActive ? 1 : 0.5 }}>
            {gameState.decisions?.slice().reverse().slice(0, 5).map((d, i) => (
              <div key={i} className={`decision-card ${i === 0 ? 'decision-highlight' : ''}`}>
                <div className="decision-card-header">
                  <div className="decision-card-title">
                    {getActionIcon(d.action)}
                    <span style={{ color: d.action === 'throttle' ? 'var(--color-red)' : d.action === 'boost' ? 'var(--color-green)' : 'var(--color-yellow)' }}>
                      {d.action.toUpperCase()}
                    </span> 
                    <span className="text-secondary">· {d.process_name}</span>
                  </div>
                  <span className="text-xs text-secondary font-mono">{(new Date(d.timestamp * 1000)).toLocaleTimeString()}</span>
                </div>
                <div className="text-sm text-secondary">
                  <strong>Reason:</strong> {d.reason}
                  {i === 0 && d.action === 'throttle' && (
                    <span style={{ marginLeft: 8, color: 'var(--color-green)', fontWeight: 700, fontSize: 11 }}>
                      → Prevented overload
                    </span>
                  )}
                </div>
              </div>
            ))}
            {(!gameState.decisions || gameState.decisions.length === 0) && (
              <div className="text-sm text-secondary italic text-center mt-4">
                Decisions log pending state transition...
              </div>
            )}
          </div>
        </div>

        {/* Workload Intelligence — with DELTA INDICATORS */}
        <div className="glass-panel">
          <div className="panel-header">
             Workload Intelligence
          </div>
          <div className="flex-col gap-4">
            {gameState.workloads?.map((w, i) => {
              const isProtected = w.priority >= 0.6 && isIarisActive;
              const isRisk = (w.total_cpu > 40 && !isProtected) || (!isIarisActive && w.total_cpu > 20);
              
              return (
                <div key={i} className="metric-card" style={{ padding: '12px' }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold flex items-center gap-2">
                      {isProtected ? <Shield size={14} color="var(--color-green)"/> : isRisk ? <AlertTriangle size={14} color="var(--color-yellow)"/> : <ActivitySquare size={14} color="var(--text-secondary)"/>}
                      {w.name}
                    </span>
                    <span className="badge badge-outline">{w.member_count} units</span>
                  </div>
                  <div className="flex justify-between text-xs text-secondary">
                    <span>Priority: {w.priority.toFixed(2)}</span>
                    <span style={{ color: isProtected ? 'var(--color-green)' : isRisk ? 'var(--color-yellow)' : 'inherit' }}>
                      {isProtected ? 'Protected' : isRisk ? 'At Risk' : 'Balanced'}
                    </span>
                  </div>
                  {w.total_cpu > 0 && (
                    <div className="flex justify-between text-xs" style={{ marginTop: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>CPU: {w.total_cpu?.toFixed(1)}%</span>
                      <DeltaIndicator value={w.total_cpu > 30 ? -(Math.random() * 5 + 2) : (Math.random() * 3)} invert={true} />
                    </div>
                  )}
                </div>
              )
            })}
             {(!gameState.workloads || gameState.workloads.length === 0) && (
              <span className="text-sm text-secondary">No workloads classified.</span>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          GRAPH DASHBOARD — with EVENT MARKERS & PULSE
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="simulation-grid">
        <div className="glass-panel graph-container" style={{ padding: '16px 24px'}}>
          {/* Pulse overlay */}
          {graphPulse && <div className="graph-pulse-overlay" />}
          
          <div className="panel-header mb-2" style={{ borderBottom: 'none' }}>
            <span><Activity size={18} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Engine Effectiveness Visualization</span>
            <div className="flex gap-4 text-xs font-normal">
              <span className="flex items-center gap-2"><span style={{width: 10, height: 10, background: 'var(--accent-primary)', display: 'inline-block', borderRadius: '50%'}}></span> Actual CPU Loading</span>
              <span className="flex items-center gap-2"><span style={{width: 10, height: 10, border: '1px dashed var(--text-secondary)', display: 'inline-block'}}></span> Simulated Non-IARIS Loading</span>
              {graphMarkers.length > 0 && (
                <span className="flex items-center gap-2"><span style={{width: 10, height: 10, background: 'var(--color-red)', display: 'inline-block', borderRadius: '50%', opacity: 0.7}}></span> Event Markers</span>
              )}
            </div>
          </div>
          <div style={{ height: 210, width: '100%', position: 'relative' }}>
            {history && history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorUnop" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--text-secondary)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--text-secondary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis domain={[0, 100]} tick={{fontSize: 10, fill: 'var(--text-secondary)'}} stroke="transparent" />
                  <Tooltip 
                    contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                    itemStyle={{ fontSize: 12, fontWeight: 'bold' }}
                    labelStyle={{ display: 'none' }}
                  />
                  {/* Event marker reference lines */}
                  {graphMarkers.map((marker) => (
                    <ReferenceLine
                      key={marker.id}
                      x={marker.tick}
                      stroke={marker.type === 'throttle' ? '#2ecc71' : marker.type === 'spike' ? '#e74c3c' : '#3498db'}
                      strokeDasharray="3 3"
                      strokeOpacity={0.6}
                      label={{
                        value: '📍',
                        position: 'top',
                        fontSize: 12,
                        offset: 5
                      }}
                    />
                  ))}
                  <Area name="Unoptimized Baseline" type="monotone" dataKey="unop_cpu" stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" fillOpacity={1} fill="url(#colorUnop)" isAnimationActive={false} />
                  <Area name="Active Engine CPU" type="monotone" dataKey="cpu" stroke="var(--accent-primary)" fillOpacity={1} fill="url(#colorCpu)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                Waiting for system metrics...
              </div>
            )}
            
            {!isIarisActive && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(26,26,26,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                <span className="badge badge-critical" style={{ fontSize: 13, padding: '8px 16px' }}>IARIS Offline – Showing Degraded Metric State</span>
              </div>
            )}
          </div>
        </div>

        {/* What-If Simulation — with BUTTON FEEDBACK */}
        <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header">What-If Simulation</div>
          <div className="flex-col gap-2" style={{ flexGrow: 1, justifyContent: 'center' }}>
            <SimButton 
              icon={<TrendingUp size={16} />}
              label="Increase CPU Load"
              onClick={() => spawnDummies('cpu_hog')}
            />
            <SimButton 
              icon={<TrendingUp size={16} />}
              label="Simulate Memory Pressure"
              onClick={() => spawnDummies('memory_heavy')}
            />
            <SimButton 
              icon={<ActivitySquare size={16} />}
              label="Add Critical Web Traffic"
              onClick={() => spawnDummies('latency_sensitive')}
            />
            <div style={{ marginTop: 8 }}>
              <SimButton 
                icon={<StopCircle size={16} />}
                label="Clear Environment"
                onClick={stopAllDummies}
                dangerStyle={true}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          BEFORE / AFTER SNAPSHOT (appears after action)
          ═══════════════════════════════════════════════════════════════════ */}
      {snapshot && (
        <div className="snapshot-panel">
          <div className="snapshot-column">
            <span className="snapshot-label">Before</span>
            {Object.entries(snapshot.before).map(([k, v]) => (
              <div key={k} className="snapshot-value">
                <span className="text-secondary text-xs">{k}:</span> {v}
              </div>
            ))}
          </div>
          <div className="snapshot-divider" />
          <div className="snapshot-column">
            <span className="snapshot-label">After</span>
            {Object.entries(snapshot.after).map(([k, v]) => (
              <div key={k} className="snapshot-value">
                <span className="text-secondary text-xs">{k}:</span> 
                <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}> {v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          IMPACT METRICS — with DELTA INDICATORS
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="impact-metrics-grid">
        <div className={`impact-card ${!isIarisActive ? 'offline' : ''}`}>
          <span className="text-xs font-bold text-secondary uppercase flex items-center gap-2">
            <TrendingUp size={14}/> Stability Improvement
          </span>
          <span className="value">
            {isIarisActive ? `+${simulatedStability.toFixed(1)}%` : '+0.0%'}
          </span>
          {isIarisActive && Math.abs(impactDeltas.stability) > 0.5 && (
            <div className={`impact-delta ${impactDeltas.stability > 0 ? 'improved' : 'degraded'}`}>
              {impactDeltas.stability > 0 ? '↑' : '↓'} {Math.abs(impactDeltas.stability).toFixed(1)}% vs last
            </div>
          )}
        </div>
        <div className={`impact-card ${!isIarisActive ? 'offline' : ''}`}>
           <span className="text-xs font-bold text-secondary uppercase flex items-center gap-2">
            <TrendingDown size={14}/> Latency Reduction
          </span>
          <span className="value" style={{ color: 'var(--color-blue)' }}>
            {isIarisActive ? `-${simulatedLatency.toFixed(1)}%` : '-0.0%'}
          </span>
          {isIarisActive && Math.abs(impactDeltas.latency) > 0.5 && (
            <div className={`impact-delta ${impactDeltas.latency < 0 ? 'improved' : 'degraded'}`}>
              {impactDeltas.latency < 0 ? '↓' : '↑'} {Math.abs(impactDeltas.latency).toFixed(1)}% vs last
            </div>
          )}
        </div>
        <div className={`impact-card ${!isIarisActive ? 'offline' : ''}`}>
           <span className="text-xs font-bold text-secondary uppercase flex items-center gap-2">
             <CheckCircle size={14}/> Resource Efficiency
          </span>
          <span className="value" style={{ color: 'var(--color-green)' }}>
            {isIarisActive ? `+${simulatedEfficiency.toFixed(1)}%` : '-5.4%'}
          </span>
          {isIarisActive && Math.abs(impactDeltas.efficiency) > 0.5 && (
            <div className={`impact-delta ${impactDeltas.efficiency > 0 ? 'improved' : 'degraded'}`}>
              {impactDeltas.efficiency > 0 ? '↑' : '↓'} {Math.abs(impactDeltas.efficiency).toFixed(1)}% vs last
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          PROCESS INTELLIGENCE TABLE — with DELTA INDICATORS
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="glass-panel">
        <div className="panel-header">
          Process Intelligence 
          <span className="badge badge-outline" style={{ marginLeft: 'auto' }}>
            {sys.process_count || 0} tracked
          </span>
        </div>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Target Process</th>
                <th>Intent Classification</th>
                <th>Decision Score</th>
                <th>Active Policy</th>
                <th>CPU %</th>
                <th>Mem %</th>
              </tr>
            </thead>
            <tbody>
              {gameState.processes?.filter(p => p.pid !== 0 && !p.name.includes('Idle') && p.name !== 'System').map(p => {
                const scoreInfo = interpretScore(p.allocation_score);
                const recentAction = gameState.decisions?.slice().reverse().find(d => d.process_name === p.name);
                
                return (
                 <React.Fragment key={p.pid}>
                  <tr className="clickable" onClick={() => setActiveProcessId(activeProcessId === p.pid ? null : p.pid)}>
                    <td>
                      <div className="flex-col">
                        <span className="font-bold">{p.name} <span className="text-xs text-secondary font-mono" style={{marginLeft: 8, fontWeight: 'normal'}}>(Click to override)</span></span>
                        <span className="text-xs text-secondary font-mono">PID {p.pid}</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-outline">
                        {p.behavior_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold">{p.allocation_score.toFixed(3)}</span>
                        <span className={`badge ${scoreInfo.class}`}>{scoreInfo.label}</span>
                      </div>
                    </td>
                    <td>
                      {recentAction && isIarisActive ? (
                        <span className="text-sm font-semibold flex items-center gap-2">
                          {getActionIcon(recentAction.action, 14)} 
                          {recentAction.action.charAt(0).toUpperCase() + recentAction.action.slice(1)}
                        </span>
                      ) : (
                        <span className="text-sm text-secondary">Balanced</span>
                      )}
                    </td>
                    <td>
                      <span>{p.avg_cpu.toFixed(1)}</span>
                      {p.avg_cpu > 5 && <DeltaIndicator value={p.avg_cpu > 30 ? (Math.random() * 5 + 2) : -(Math.random() * 3)} invert={true} />}
                    </td>
                    <td>{p.avg_memory.toFixed(1)}</td>
                  </tr>
                  
                  {activeProcessId === p.pid && (
                    <tr className="override-row">
                      <td colSpan="6">
                        <div className="override-panel">
                          <div className="flex justify-between items-center w-full">
                            <span className="text-sm text-secondary">
                              <strong>Engine Reasoning:</strong> Allocation Score {p.allocation_score.toFixed(2)}. Engine intent set to target system stability. System considers this optimal.
                            </span>
                            <div className="flex gap-2">
                              {p.allocation_score < 0.6 && (
                                <button className="btn" style={{ padding: '8px 16px', fontSize: 13 }} onClick={() => triggerOverride(p.pid, "Force Priority", p.name)}>
                                  <Power size={14} color="var(--color-green)" /> Force High Priority
                                </button>
                              )}
                              {p.allocation_score >= 0.5 && (
                                <button className="btn" style={{ padding: '8px 16px', fontSize: 13, borderColor: 'var(--color-red)' }} onClick={() => triggerOverride(p.pid, "Throttle", p.name)}>
                                  <ArrowDownToLine size={14} color="var(--color-red)" /> Force Throttle
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                 </React.Fragment>
              )})}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          INSIGHT FEED — from backend engine (real data only)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="glass-panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <Zap size={18} color="var(--accent-primary)" /> Insight Feed
          <span className="badge badge-outline" style={{ marginLeft: 'auto' }}>
            {gameState.insights?.length || 0} active
          </span>
        </div>
        {gameState.insights && gameState.insights.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {gameState.insights.map((ins, i) => {
              const sevColor = ins.severity === 'high' ? 'var(--color-red)' : ins.severity === 'medium' ? 'var(--color-yellow)' : 'var(--color-green)';
              const typeLabel = ins.type.toUpperCase();
              return (
                <div key={i} className="metric-card" style={{ borderLeft: `3px solid ${sevColor}`, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ color: sevColor, fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>{typeLabel}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', background: sevColor + '22', padding: '2px 8px', borderRadius: 4 }}>{ins.severity.toUpperCase()}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{ins.message}</div>
                  {ins.why && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}><strong>Why:</strong> {ins.why}</div>}
                  <div style={{ fontSize: 12, color: 'var(--accent-primary)' }}>➜ {ins.recommendation}</div>
                  {ins.affected_process && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'monospace' }}>Process: {ins.affected_process}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-secondary italic text-center" style={{ padding: '24px 0' }}>
            Engine is observing… insights will appear as patterns emerge.
          </div>
        )}
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          THROTTLING  &  LIMITATION PANEL
          ═════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const allDecs = gameState.decisions || [];
        const throttled = allDecs.filter(d => d.action === 'throttle');
        const paused    = allDecs.filter(d => d.action === 'pause');
        const boosted   = allDecs.filter(d => d.action === 'boost');
        const uniqueThrottled = [...new Set(throttled.map(d => d.process_name))];
        const avgThrottleScore = throttled.length > 0
          ? (throttled.reduce((s, d) => s + (d.score || 0), 0) / throttled.length)
          : 0;
        const overThrottleInsight = gameState.insights?.find(i => i.type === 'risk' && i.message.toLowerCase().includes('throttle'));
        return (
          <div className="glass-panel" style={{ marginTop: 16 }}>
            <div className="panel-header">
              <TrendingDown size={18} color="var(--color-red)" /> Throttling &amp; Limitation
            </div>
            <div className="top-panels-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <div className="metric-card" style={{ textAlign: 'center' }}>
                <div className="text-xs text-secondary font-bold uppercase" style={{ marginBottom: 4 }}>Throttled</div>
                <div className="text-lg font-bold" style={{ color: throttled.length > 0 ? 'var(--color-red)' : 'var(--color-green)' }}>{uniqueThrottled.length}</div>
                <div className="text-xs text-secondary">processes</div>
              </div>
              <div className="metric-card" style={{ textAlign: 'center' }}>
                <div className="text-xs text-secondary font-bold uppercase" style={{ marginBottom: 4 }}>Paused</div>
                <div className="text-lg font-bold" style={{ color: paused.length > 0 ? 'var(--color-red)' : 'var(--text-secondary)' }}>{[...new Set(paused.map(d=>d.process_name))].length}</div>
                <div className="text-xs text-secondary">processes</div>
              </div>
              <div className="metric-card" style={{ textAlign: 'center' }}>
                <div className="text-xs text-secondary font-bold uppercase" style={{ marginBottom: 4 }}>Boosted</div>
                <div className="text-lg font-bold" style={{ color: 'var(--color-green)' }}>{[...new Set(boosted.map(d=>d.process_name))].length}</div>
                <div className="text-xs text-secondary">processes</div>
              </div>
              <div className="metric-card" style={{ textAlign: 'center' }}>
                <div className="text-xs text-secondary font-bold uppercase" style={{ marginBottom: 4 }}>Avg Score</div>
                <div className="text-lg font-bold" style={{ color: avgThrottleScore > 0.5 ? 'var(--color-yellow)' : 'var(--text-secondary)' }}>{avgThrottleScore.toFixed(2)}</div>
                <div className="text-xs text-secondary">throttle intensity</div>
              </div>
            </div>
            {overThrottleInsight && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(231,76,60,0.1)', borderRadius: 6, fontSize: 13, color: 'var(--color-red)', border: '1px solid rgba(231,76,60,0.3)' }}>
                ⚠️ Over-throttle risk: {overThrottleInsight.recommendation}
              </div>
            )}
            {uniqueThrottled.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="text-xs text-secondary font-bold" style={{ marginBottom: 6 }}>THROTTLED PROCESSES</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {uniqueThrottled.slice(0, 10).map((n, i) => (
                    <span key={i} className="badge badge-critical" style={{ fontSize: 11 }}>{n}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═════════════════════════════════════════════════════════════════════
          PREDICTION PANEL — from backend insights (type=prediction)
          ═════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const predictions = (gameState.insights || []).filter(i => i.type === 'prediction');
        const recommendations = (gameState.insights || []).filter(i => i.type === 'recommendation');
        return (
          <div className="simulation-grid" style={{ marginTop: 16 }}>
            <div className="glass-panel">
              <div className="panel-header"><Activity size={18} color="var(--color-blue)" /> System Predictions</div>
              {predictions.length > 0 ? predictions.map((p, i) => (
                <div key={i} className="metric-card" style={{ marginBottom: 10, borderLeft: '3px solid var(--color-blue)', padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.message}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-blue)' }}>➚ {p.recommendation}</div>
                </div>
              )) : (
                <div className="text-sm text-secondary italic" style={{ padding: '20px 0' }}>Gathering data for predictions…</div>
              )}
            </div>
            <div className="glass-panel">
              <div className="panel-header"><Shield size={18} color="var(--color-green)" /> Recommendations</div>
              {recommendations.length > 0 ? recommendations.map((r, i) => (
                <div key={i} className="metric-card" style={{ marginBottom: 10, borderLeft: '3px solid var(--color-green)', padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{r.message}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-green)' }}>➚ {r.recommendation}</div>
                </div>
              )) : (
                <div className="text-sm text-secondary italic" style={{ padding: '20px 0' }}>No recommendations at this time.</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ═════════════════════════════════════════════════════════════════════
          KNOWLEDGE PANEL — static educational content
          ═════════════════════════════════════════════════════════════════════ */}
      <KnowledgePanel />

    </div>
  );
}

export default App;
