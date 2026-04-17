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
  ReferenceLine,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  ZAxis,
  Legend
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
    <span className={`delta-indicator ${cls}`}>
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
    category: 'Control Policy',
    confidence: 'High',
    what: 'Throttling reduces the CPU time slice allocated to a process, slowing it down.',
    why: 'When a CPU hog consumes excessive resources, it starves latency-sensitive processes.',
    how: 'IARIS automatically throttles low-priority processes when system state enters PRESSURE or CRITICAL.',
    evidence: [
      'Throttle tendency rises when CPU pressure increases above operational comfort bands.',
      'Recent engine decisions show throttle events mapped to overloaded processes.',
    ],
    operatorCheck: 'If latency drops after throttling while system stability improves, the policy is working as intended.',
    trustNote: 'Policy is grounded in live process telemetry and deterministic score thresholds.',
  },
  {
    title: 'What is EWMA?',
    category: 'Modeling',
    confidence: 'High',
    what: 'Exponential Weighted Moving Average — a smoothing algorithm that learns process behavior over time.',
    why: 'Raw CPU samples are noisy. EWMA gives recent samples more weight while retaining historical context.',
    how: 'IARIS uses EWMA with α=0.3 (warmup) → α=0.1 (steady) to converge process profiles in 30–90 seconds.',
    evidence: [
      'EWMA dampens short spikes while preserving sustained behavioral trends.',
      'Classification confidence rises as the number of observations grows.',
    ],
    operatorCheck: 'Watch for reduced metric volatility over consecutive updates as profiles stabilize.',
    trustNote: 'Method is a standard statistical smoother commonly used in production monitoring systems.',
  },
  {
    title: 'What is a CPU Hog?',
    category: 'Classification',
    confidence: 'Medium',
    what: 'A process classified as cpu_hog sustains CPU usage above 30% across multiple samples.',
    why: 'Sustained high CPU consumption indicates batch computation, compilation, or runaway loops.',
    how: 'IARIS throttles cpu_hog processes when system is under pressure, protecting latency-sensitive services.',
    evidence: [
      'CPU-hog labels correlate with top-bar CPU processes in visualization panels.',
      'Repeated high CPU windows increase probability of protective scheduling actions.',
    ],
    operatorCheck: 'Confirm whether the same process remains in top CPU ranks across multiple updates.',
    trustNote: 'Classification relies on observed behavior windows rather than one-off spikes.',
  },
  {
    title: 'How does IARIS decide?',
    category: 'Decisioning',
    confidence: 'High',
    what: 'IARIS computes an allocation_score (0–1) per process using behavior type, system state, and priority.',
    why: 'Score reflects impact: high score = high need for resources. Score drives the throttle/boost/maintain decision.',
    how: 'Boost: score ≥ 0.6 + system stress. Throttle: score < 0.4 + system pressure. Maintain: everything else.',
    evidence: [
      'Decision logs align with score distribution visible in the histogram and process table.',
      'High-score processes are more likely to be protected or boosted under pressure.',
    ],
    operatorCheck: 'Cross-check a process score in Process Intelligence against its latest policy action.',
    trustNote: 'Decision policy is transparent and auditable through score, reason, and action history.',
  },
  {
    title: 'What is the Cold Start problem?',
    category: 'Reliability',
    confidence: 'Medium',
    what: 'On first observation, IARIS has no history for a new process — allocation quality is uncertain.',
    why: 'Without historical data, the engine cannot accurately classify behavior or score allocation.',
    how: 'IARIS uses similarity matching to bootstrap new processes from known profiles, achieving ~82% accuracy immediately.',
    evidence: [
      'Newly observed processes initially have limited confidence until enough samples are collected.',
      'Similarity bootstrapping reduces unstable decisions during early process life-cycle.',
    ],
    operatorCheck: 'For newly spawned apps, verify that recommendations become more stable after several updates.',
    trustNote: 'Engine explicitly distinguishes early-learning behavior from mature profiles.',
  },
  {
    title: 'What are Learning Phases?',
    category: 'Lifecycle',
    confidence: 'High',
    what: 'Bootstrap → Adaptation → Stable. Each phase reflects how well the engine knows a process.',
    why: 'Processes in bootstrap have < 10 samples. Adaptation means EWMA is still converging. Stable means high confidence.',
    how: 'All processes reach stable phase within 90 seconds of observation. Decisions are most accurate in stable phase.',
    evidence: [
      'Longer-observed processes show lower volatility in score and policy changes.',
      'Stable phase processes drive more predictable scheduler outcomes.',
    ],
    operatorCheck: 'When many processes are in early phases, expect temporary fluctuations before convergence.',
    trustNote: 'Phase model provides explicit confidence progression instead of hiding uncertainty.',
  },
];

function KnowledgePanel({ gameState, isIarisActive }) {
  const [openIdx, setOpenIdx] = React.useState(null);
  const [searchText, setSearchText] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState('All');

  const categories = ['All', ...new Set(KNOWLEDGE_ENTRIES.map((entry) => entry.category))];
  const normalizedSearch = searchText.trim().toLowerCase();

  const filteredEntries = KNOWLEDGE_ENTRIES.filter((entry) => {
    const matchesCategory = activeCategory === 'All' || entry.category === activeCategory;
    const searchable = [
      entry.title,
      entry.what,
      entry.why,
      entry.how,
      ...(entry.evidence || []),
      entry.operatorCheck,
      entry.trustNote,
    ].join(' ').toLowerCase();

    const matchesSearch = normalizedSearch.length === 0 || searchable.includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });

  const trackedProcesses = (gameState?.processes || []).filter(
    (p) => p.pid !== 0 && !p.name.includes('Idle') && p.name !== 'System'
  );

  const latestDecision = gameState?.decisions?.length
    ? gameState.decisions[gameState.decisions.length - 1]
    : null;

  const highSeverityInsights = (gameState?.insights || []).filter((ins) => ins.severity === 'high').length;
  const recommendationInsight = (gameState?.insights || []).find((ins) => ins.type === 'recommendation');

  return (
    <div className="glass-panel knowledge-panel" style={{ marginTop: 16 }}>
      <div className="panel-header">
        <FlaskConical size={18} color="var(--color-purple)" /> Knowledge Base
        <span className="text-xs text-secondary knowledge-header-note" style={{ marginLeft: 'auto' }}>
          Evidence-backed guidance refreshed on update #{gameState?.tick_count || 0}
        </span>
      </div>
      <div className="knowledge-trust-grid">
        <div className="knowledge-trust-card">
          <span className="knowledge-trust-label">Engine Status</span>
          <span className={`knowledge-trust-value ${isIarisActive ? 'stat-good' : 'stat-bad'}`}>
            {isIarisActive ? 'IARIS Active' : 'Fallback Scheduler Active'}
          </span>
        </div>
        <div className="knowledge-trust-card">
          <span className="knowledge-trust-label">Tracked Processes</span>
          <span className="knowledge-trust-value">{trackedProcesses.length}</span>
        </div>
        <div className="knowledge-trust-card">
          <span className="knowledge-trust-label">High Severity Signals</span>
          <span className={`knowledge-trust-value ${highSeverityInsights > 0 ? 'stat-bad' : 'stat-good'}`}>
            {highSeverityInsights}
          </span>
        </div>
        <div className="knowledge-trust-card">
          <span className="knowledge-trust-label">Latest Engine Action</span>
          <span className="knowledge-trust-value">
            {latestDecision ? `${latestDecision.action.toUpperCase()} ${latestDecision.process_name}` : 'No action yet'}
          </span>
        </div>
      </div>

      <div className="knowledge-controls">
        <input
          type="text"
          className="knowledge-search"
          placeholder="Search concepts, policies, thresholds, actions..."
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <div className="knowledge-categories">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={`knowledge-chip ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="knowledge-list">
        {filteredEntries.map((entry, i) => (
          <div key={entry.title}
            className="knowledge-item"
          >
            <button
              type="button"
              className={`knowledge-item-header ${openIdx === i ? 'open' : ''}`}
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              aria-expanded={openIdx === i}
            >
              <span className="knowledge-item-title">{entry.title}</span>
              <div className="knowledge-item-meta">
                <span className="badge badge-outline">{entry.category}</span>
                <span className={`badge ${entry.confidence === 'High' ? 'badge-green' : 'badge-yellow'}`}>
                  Confidence: {entry.confidence}
                </span>
                <span className="knowledge-expand-icon">{openIdx === i ? '▲' : '▼'}</span>
              </div>
            </button>
            {openIdx === i && (
              <div className="knowledge-item-content">
                <div className="knowledge-section">
                  <span className="knowledge-section-label section-what">WHAT</span>
                  <span>{entry.what}</span>
                </div>
                <div className="knowledge-section">
                  <span className="knowledge-section-label section-why">WHY</span>
                  <span>{entry.why}</span>
                </div>
                <div className="knowledge-section">
                  <span className="knowledge-section-label section-how">HOW</span>
                  <span>{entry.how}</span>
                </div>
                <div className="knowledge-section knowledge-section-block">
                  <span className="knowledge-section-label section-evidence">EVIDENCE SIGNALS</span>
                  <ul className="knowledge-evidence-list">
                    {entry.evidence.map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                </div>
                <div className="knowledge-operator-check">
                  <strong>Operator Check:</strong> {entry.operatorCheck}
                </div>
                <div className="knowledge-trust-note">
                  <strong>Trust Basis:</strong> {entry.trustNote}
                </div>
              </div>
            )}
          </div>
        ))}

        {filteredEntries.length === 0 && (
          <div className="knowledge-empty-state">
            No matching concept found. Try a broader search or switch to another category.
          </div>
        )}
      </div>

      <div className="knowledge-footer-note">
        {recommendationInsight
          ? `Current recommendation: ${recommendationInsight.recommendation}`
          : 'No recommendation emitted yet. Continue simulation to generate context-aware recommendations.'}
      </div>
    </div>
  );
}

function App() {
  const tabConfig = [
    { id: 'VISUALIZATION', label: 'VISUALIZATION' },
    { id: 'RESULTS AND SIMULATION', label: 'RESULTS AND SIMULATION' },
    { id: 'KEY INSIGHTS', label: 'KEY INSIGHTS' },
    { id: 'IMPACT ANALYSIS', label: 'IMPACT ANALISIS' },
    { id: 'KNOWLEDGE BASE', label: 'KNOWLEDGE BASE' },
  ];

  const [gameState, setGameState] = useState({
    system: { cpu_percent: 0, memory_percent: 0, state: 'STABLE', behavior: 'BALANCED' },
    processes: [],
    workloads: [],
    decisions: [],
    dummy_processes: [],
    tick_count: 0,
    insights: [],
    efficiency: { overall: 0, cpu: 0, memory: 0, latency: 0, process_balance: 50 },
    observability: { snapshot: {}, diff: {}, changes: [], recent_changes: [], significant: false, significance_reason: '' },
    intelligence: { significant: false, reason: '', used_cache: false, source: 'local', insight: '', last_updated: 0 },
  });

  const [history, setHistory] = useState([]);
  
  // Interaction Layer specific states
  const [isIarisActive, setIsIarisActive] = useState(true);
  const isIarisActiveRef = useRef(isIarisActive);
  
  const [activeProcessId, setActiveProcessId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('VISUALIZATION');

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
  const feedbackImpactRef = useRef({ stability: 0, latency: 0, efficiency: 0 });

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

          const currentImpact = {
            stability: data.efficiency?.process_balance ?? 0,
            latency: data.efficiency?.latency ?? 0,
            efficiency: data.efficiency?.overall ?? 0,
          };
          const prevImpactInstant = feedbackImpactRef.current;
          const impactDelta = {
            stability: currentImpact.stability - prevImpactInstant.stability,
            latency: currentImpact.latency - prevImpactInstant.latency,
            efficiency: currentImpact.efficiency - prevImpactInstant.efficiency,
          };
          feedbackImpactRef.current = currentImpact;
          
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
                  {
                    text: `Latency ${impactDelta.latency <= 0 ? '↓' : '↑'} ${Math.abs(impactDelta.latency).toFixed(1)}%`,
                    type: impactDelta.latency <= 0 ? 'positive' : 'negative'
                  },
                  {
                    text: `Stability ${impactDelta.stability >= 0 ? '↑' : '↓'} ${Math.abs(impactDelta.stability).toFixed(1)}%`,
                    type: impactDelta.stability >= 0 ? 'positive' : 'negative'
                  },
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
              unop_cpu: isIarisActiveRef.current ? unoptimizedCpu : render_cpu, // lock to standard curve if off
              stability: data.efficiency?.process_balance ?? 0,
              latency: data.efficiency?.latency ?? 0,
              efficiency: data.efficiency?.overall ?? 0,
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
      const efficiency = gameState.efficiency?.overall ?? 50;
      const projectedDrop = Math.max(8, Math.min(25, (100 - efficiency) * 0.2));
      msg = `WARNING: Overriding IARIS intent. System stability projected to decrease by ${projectedDrop.toFixed(1)}% due to resource starvation caused by ${pName}.`;
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
  const observability = gameState.observability || { snapshot: {}, diff: {}, changes: [], recent_changes: [] };
  const intelligence = gameState.intelligence || { insight: '', reason: '', used_cache: false, source: 'local', significant: false, last_updated: 0 };
  const recentChanges = (observability.recent_changes || []).slice(-10).reverse();
  
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

  const getTrendDelta = (series, key, windowSize = 6) => {
    if (!series || series.length < windowSize * 2) return 0;
    const recent = series.slice(-windowSize);
    const previous = series.slice(-windowSize * 2, -windowSize);

    const average = (values) => {
      if (!values.length) return 0;
      return values.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / values.length;
    };

    return average(recent) - average(previous);
  };

  const latestPoint = history.length > 0 ? history[history.length - 1] : null;
  const latestCpu = latestPoint?.cpu ?? 0;
  const latestMemory = latestPoint?.memory ?? 0;
  const latestEfficiency = latestPoint?.efficiency ?? 0;
  const latestLatency = latestPoint?.latency ?? 0;

  const cpuAdvantage = latestPoint ? latestPoint.unop_cpu - latestPoint.cpu : 0;
  const memoryTrendDelta = getTrendDelta(history, 'memory');
  const cpuTrendDelta = getTrendDelta(history, 'cpu');
  const efficiencyTrendDelta = getTrendDelta(history, 'efficiency');
  const latencyTrendDelta = getTrendDelta(history, 'latency');

  const memoryStatus = latestMemory >= 85 ? 'Critical' : latestMemory >= 65 ? 'Pressure' : 'Healthy';
  const performanceBalance = latestEfficiency - latestLatency;
  const balanceStatus = performanceBalance >= 12 ? 'Efficiency Leading' : performanceBalance >= 0 ? 'Balanced' : 'Latency Dominant';

  const chartTooltipStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
  };

  const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;
  const formatTime = (unixTs) => {
    if (!unixTs) return '--:--:--';
    return new Date(unixTs * 1000).toLocaleTimeString();
  };

  const trackedProcesses = (gameState.processes || []).filter(
    (p) => p.pid !== 0 && !p.name.includes('Idle') && p.name !== 'System'
  );

  const processResourceBars = trackedProcesses
    .slice()
    .sort((a, b) => b.avg_cpu - a.avg_cpu)
    .slice(0, 8)
    .map((p) => ({
      process: p.name.length > 18 ? `${p.name.slice(0, 18)}...` : p.name,
      fullName: p.name,
      cpu: Number(p.avg_cpu.toFixed(1)),
      memory: Number(p.avg_memory.toFixed(1)),
      score: Number((p.allocation_score * 100).toFixed(1)),
    }));

  const scoreBins = [
    { min: 0.0, max: 0.2, label: '0.0-0.2' },
    { min: 0.2, max: 0.4, label: '0.2-0.4' },
    { min: 0.4, max: 0.6, label: '0.4-0.6' },
    { min: 0.6, max: 0.8, label: '0.6-0.8' },
    { min: 0.8, max: 1.01, label: '0.8-1.0' },
  ];

  const allocationHistogram = scoreBins.map((bin) => {
    const binItems = trackedProcesses.filter((p) => p.allocation_score >= bin.min && p.allocation_score < bin.max);
    const avgCpu = binItems.length > 0
      ? binItems.reduce((sum, p) => sum + p.avg_cpu, 0) / binItems.length
      : 0;

    return {
      bucket: bin.label,
      count: binItems.length,
      avgCpu: Number(avgCpu.toFixed(1)),
    };
  });

  const processScatterData = trackedProcesses.slice(0, 64).map((p) => ({
    x: Number(p.avg_cpu.toFixed(1)),
    y: Number(p.avg_memory.toFixed(1)),
    z: Math.max(4, Number((p.allocation_score * 100).toFixed(1))),
    name: p.name,
    score: Number((p.allocation_score * 100).toFixed(1)),
    behavior: p.behavior_type,
  }));

  const highestCpuProcess = processResourceBars[0]?.fullName || 'N/A';
  const highestCpuValue = processResourceBars[0]?.cpu || 0;
  const overloadedCount = trackedProcesses.filter((p) => p.avg_cpu >= 25).length;

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
      {/* TABS NAVIGATION */}
      <div className="tabs-container" style={{ display: 'flex', gap: '8px', padding: '16px 0 8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '16px' }}>
        {tabConfig.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              background: activeTab === tab.id ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
              color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
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

      {activeTab === 'VISUALIZATION' && (
        <>
        <div className="visualization-layout">
          <div className="glass-panel graph-container visualization-main visualization-main-panel" style={{ padding: '16px 24px'}}>
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
            <p className="chart-context-text">
              Compares live CPU load against a simulated non-IARIS baseline over the latest 60 updates. Lower actual CPU versus baseline indicates optimization.
            </p>
            <div className="chart-summary-row">
              <div className="chart-stat">
                <span className="chart-stat-label">Current CPU</span>
                <span className="chart-stat-value">{formatPercent(latestCpu)}</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">IARIS vs Baseline</span>
                <span className={`chart-stat-value ${cpuAdvantage >= 0 ? 'stat-good' : 'stat-bad'}`}>
                  {cpuAdvantage >= 0 ? '↓' : '↑'} {formatPercent(Math.abs(cpuAdvantage))}
                </span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">CPU Trend (6-tick avg)</span>
                <span className={`chart-stat-value ${cpuTrendDelta <= 0 ? 'stat-good' : 'stat-bad'}`}>
                  {cpuTrendDelta >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(cpuTrendDelta))}
                </span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">Detected Events</span>
                <span className="chart-stat-value">{markerPositions.length}</span>
              </div>
            </div>
            <div className="visualization-main-chart" style={{ width: '100%', position: 'relative' }}>
              {history && history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
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
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      minTickGap={24}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      tickLine={false}
                      axisLine={false}
                      width={34}
                    />
                    <Tooltip 
                      contentStyle={chartTooltipStyle}
                      itemStyle={{ fontSize: 12, fontWeight: 'bold' }}
                      labelStyle={{ color: 'var(--text-secondary)', fontSize: 11 }}
                      labelFormatter={(label) => `Update #${label}`}
                      formatter={(value, name) => [formatPercent(value), name]}
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

          <div className="glass-panel visualization-mini visualization-memory">
              <div className="panel-header" style={{ marginBottom: 12 }}>
                <span><HardDrive size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Memory Trend</span>
              </div>
              <p className="chart-context-text chart-context-mini">
                RAM utilization history. Sustained levels above 75% indicate probable memory pressure.
              </p>
              <div className="chart-summary-row chart-summary-mini">
                <div className="chart-stat">
                  <span className="chart-stat-label">Current</span>
                  <span className="chart-stat-value">{formatPercent(latestMemory)}</span>
                </div>
                <div className="chart-stat">
                  <span className="chart-stat-label">Trend (6-tick avg)</span>
                  <span className={`chart-stat-value ${memoryTrendDelta <= 0 ? 'stat-good' : 'stat-bad'}`}>
                    {memoryTrendDelta >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(memoryTrendDelta))}
                  </span>
                </div>
                <div className="chart-stat">
                  <span className="chart-stat-label">Health</span>
                  <span className={`chart-stat-value ${memoryStatus === 'Healthy' ? 'stat-good' : memoryStatus === 'Pressure' ? 'stat-warn' : 'stat-bad'}`}>
                    {memoryStatus}
                  </span>
                </div>
              </div>
              <div style={{ height: 150, width: '100%' }}>
                {history && history.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 8, right: 6, left: 2, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorMemory" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-blue)" stopOpacity={0.35}/>
                          <stop offset="95%" stopColor="var(--color-blue)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="time" hide />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} width={28} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={{ color: 'var(--text-secondary)', fontSize: 11 }}
                        labelFormatter={(label) => `Update #${label}`}
                        formatter={(value, name) => [formatPercent(value), name]}
                      />
                      <Area name="Memory Usage" type="monotone" dataKey="memory" stroke="var(--color-blue)" fillOpacity={1} fill="url(#colorMemory)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                    Waiting for memory telemetry...
                  </div>
                )}
              </div>
          </div>

          <div className="glass-panel visualization-mini visualization-efficiency">
              <div className="panel-header" style={{ marginBottom: 12 }}>
                <span><Zap size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Efficiency vs Latency</span>
              </div>
              <p className="chart-context-text chart-context-mini">
                Higher efficiency with lower latency indicates better scheduling quality and service responsiveness.
              </p>
              <div className="chart-summary-row chart-summary-mini">
                <div className="chart-stat">
                  <span className="chart-stat-label">Efficiency</span>
                  <span className={`chart-stat-value ${efficiencyTrendDelta >= 0 ? 'stat-good' : 'stat-bad'}`}>
                    {formatPercent(latestEfficiency)}
                  </span>
                </div>
                <div className="chart-stat">
                  <span className="chart-stat-label">Latency</span>
                  <span className={`chart-stat-value ${latencyTrendDelta <= 0 ? 'stat-good' : 'stat-bad'}`}>
                    {formatPercent(latestLatency)}
                  </span>
                </div>
                <div className="chart-stat">
                  <span className="chart-stat-label">Balance</span>
                  <span className={`chart-stat-value ${performanceBalance >= 0 ? 'stat-good' : 'stat-bad'}`}>
                    {balanceStatus}
                  </span>
                </div>
              </div>
              <div style={{ height: 150, width: '100%' }}>
                {history && history.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 8, right: 6, left: 2, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorEfficiency" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-green)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="var(--color-green)" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-yellow)" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="var(--color-yellow)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="time" hide />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} width={28} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={{ color: 'var(--text-secondary)', fontSize: 11 }}
                        labelFormatter={(label) => `Update #${label}`}
                        formatter={(value, name) => [formatPercent(value), name === 'Efficiency' ? 'Efficiency (higher is better)' : 'Latency (lower is better)']}
                      />
                      <Area name="Efficiency" type="monotone" dataKey="efficiency" stroke="var(--color-green)" fillOpacity={1} fill="url(#colorEfficiency)" isAnimationActive={false} />
                      <Area name="Latency" type="monotone" dataKey="latency" stroke="var(--color-yellow)" fillOpacity={1} fill="url(#colorLatency)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                    Waiting for efficiency telemetry...
                  </div>
                )}
              </div>
          </div>
        </div>

        <div className="detail-graphs-grid">
          <div className="glass-panel detail-graph-card">
            <div className="panel-header" style={{ marginBottom: 12 }}>
              <span><Cpu size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Top Process Resource Mix (Bar)</span>
            </div>
            <p className="chart-context-text chart-context-mini">
              Compares per-process CPU, memory, and allocation score (top 8 by CPU load). Useful for identifying heavy applications quickly.
            </p>
            <div className="chart-summary-row chart-summary-mini">
              <div className="chart-stat">
                <span className="chart-stat-label">Highest CPU Process</span>
                <span className="chart-stat-value" title={highestCpuProcess}>{highestCpuProcess}</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">Peak CPU</span>
                <span className="chart-stat-value stat-bad">{formatPercent(highestCpuValue)}</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">Processes Above 25% CPU</span>
                <span className={`chart-stat-value ${overloadedCount > 0 ? 'stat-bad' : 'stat-good'}`}>{overloadedCount}</span>
              </div>
            </div>
            <div className="detail-graph-chart">
              {processResourceBars.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={processResourceBars} margin={{ top: 4, right: 10, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="process" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} interval={0} angle={-20} textAnchor="end" height={45} />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      tickLine={false}
                      axisLine={false}
                      label={{ value: 'Usage / Score (%)', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-secondary)', fontSize: 10 } }}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={{ color: 'var(--text-secondary)', fontSize: 11 }}
                      formatter={(value, name, item) => [formatPercent(value), name]}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar name="CPU %" dataKey="cpu" fill="var(--accent-primary)" radius={[3, 3, 0, 0]} />
                    <Bar name="Memory %" dataKey="memory" fill="var(--color-blue)" radius={[3, 3, 0, 0]} />
                    <Bar name="Allocation Score %" dataKey="score" fill="var(--color-green)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="detail-graph-empty">Waiting for process resource telemetry...</div>
              )}
            </div>
            <p className="detail-graph-footer">
              Interpretation: large CPU bars with low allocation score usually indicate candidates for throttling.
            </p>
          </div>

          <div className="glass-panel detail-graph-card">
            <div className="panel-header" style={{ marginBottom: 12 }}>
              <span><ActivitySquare size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Allocation Score Histogram</span>
            </div>
            <p className="chart-context-text chart-context-mini">
              Histogram of process allocation scores grouped into score bands. Shows how workloads are distributed from background to critical.
            </p>
            <div className="chart-summary-row chart-summary-mini">
              <div className="chart-stat">
                <span className="chart-stat-label">Tracked Processes</span>
                <span className="chart-stat-value">{trackedProcesses.length}</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">High Priority (0.8-1.0)</span>
                <span className="chart-stat-value stat-good">{allocationHistogram[4]?.count || 0}</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">Low Priority (0.0-0.2)</span>
                <span className="chart-stat-value stat-warn">{allocationHistogram[0]?.count || 0}</span>
              </div>
            </div>
            <div className="detail-graph-chart">
              {trackedProcesses.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={allocationHistogram} margin={{ top: 4, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="bucket"
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      label={{ value: 'Allocation Score Range', position: 'insideBottom', offset: -4, style: { fill: 'var(--text-secondary)', fontSize: 10 } }}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      tickLine={false}
                      axisLine={false}
                      label={{ value: 'Process Count', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-secondary)', fontSize: 10 } }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={{ color: 'var(--text-secondary)', fontSize: 11 }}
                      formatter={(value, name) => [name === 'Processes' ? value : formatPercent(value), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" name="Processes" dataKey="count" fill="var(--color-purple)" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" name="Avg CPU in Bin" dataKey="avgCpu" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="detail-graph-empty">Waiting for process classification telemetry...</div>
              )}
            </div>
            <p className="detail-graph-footer">
              Interpretation: if low-score bins dominate while CPU rises, scheduler pressure is increasing and balancing actions are expected.
            </p>
          </div>

          <div className="glass-panel detail-graph-card">
            <div className="panel-header" style={{ marginBottom: 12 }}>
              <span><Server size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Process Footprint Scatter</span>
            </div>
            <p className="chart-context-text chart-context-mini">
              Scatter view of each process: X = CPU, Y = Memory, bubble size = allocation score. Reveals heavy and imbalanced applications.
            </p>
            <div className="chart-summary-row chart-summary-mini">
              <div className="chart-stat">
                <span className="chart-stat-label">Plotted Processes</span>
                <span className="chart-stat-value">{processScatterData.length}</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">CPU-Memory Outliers</span>
                <span className="chart-stat-value stat-warn">
                  {processScatterData.filter((p) => p.x >= 30 || p.y >= 30).length}
                </span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">Large Score Bubbles (&gt;70)</span>
                <span className="chart-stat-value stat-good">
                  {processScatterData.filter((p) => p.score >= 70).length}
                </span>
              </div>
            </div>
            <div className="detail-graph-chart">
              {processScatterData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="CPU"
                      unit="%"
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      tickLine={false}
                      label={{ value: 'CPU Usage (%)', position: 'insideBottom', offset: -4, style: { fill: 'var(--text-secondary)', fontSize: 10 } }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Memory"
                      unit="%"
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                      tickLine={false}
                      axisLine={false}
                      label={{ value: 'Memory Usage (%)', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-secondary)', fontSize: 10 } }}
                    />
                    <ZAxis type="number" dataKey="z" range={[70, 380]} name="Allocation Score" unit="%" />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      contentStyle={chartTooltipStyle}
                      formatter={(value, name) => {
                        if (name === 'Allocation Score') return [formatPercent(value), name];
                        return [`${Number(value).toFixed(1)}%`, name];
                      }}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.name || 'Process'}
                    />
                    <Scatter name="Process Footprint" data={processScatterData} fill="var(--color-blue)" fillOpacity={0.65} />
                  </ScatterChart>
                </ResponsiveContainer>
              ) : (
                <div className="detail-graph-empty">Waiting for process footprint telemetry...</div>
              )}
            </div>
            <p className="detail-graph-footer">
              Interpretation: top-right bubbles are resource-heavy processes; larger circles indicate stronger scheduling priority.
            </p>
          </div>
        </div>
        </>
      )}

      {activeTab === 'RESULTS AND SIMULATION' && (
        <>
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
        {/* What-If Simulation — with BUTTON FEEDBACK */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
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
          <div style={{ marginTop: '16px' }}>
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
          </div>
        </>
      )}

      {activeTab === 'KEY INSIGHTS' && (
        <>
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
          <Shield size={18} color="var(--color-blue)" /> Intelligence Layer
          <span className="badge badge-outline" style={{ marginLeft: 'auto' }}>
            {intelligence.used_cache ? 'cache reused' : 'fresh'}
          </span>
        </div>
        <div className="intelligence-summary-grid">
          <div className="metric-card" style={{ padding: '12px 14px' }}>
            <div className="text-xs text-secondary" style={{ marginBottom: 6 }}>CURRENT INSIGHT</div>
            <div style={{ fontWeight: 600, lineHeight: 1.4 }}>{intelligence.insight || 'Awaiting meaningful change signal.'}</div>
            <div className="text-xs text-secondary" style={{ marginTop: 8 }}>
              Source: {intelligence.source} | Last updated: {formatTime(intelligence.last_updated)}
            </div>
          </div>
          <div className="metric-card" style={{ padding: '12px 14px' }}>
            <div className="text-xs text-secondary" style={{ marginBottom: 6 }}>SIGNIFICANCE GATE</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {intelligence.significant ? 'Meaningful change detected' : 'No meaningful change'}
            </div>
            <div className="text-sm text-secondary">Reason: {intelligence.reason || 'No reason available'}</div>
            <div className="text-sm text-secondary">Current snapshot time: {formatTime(observability.snapshot?.timestamp)}</div>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <Activity size={18} color="var(--accent-primary)" /> Observability Feed
          <span className="badge badge-outline" style={{ marginLeft: 'auto' }}>
            {(recentChanges || []).length} latest events
          </span>
        </div>
        {recentChanges.length > 0 ? (
          <div className="observability-feed-list">
            {recentChanges.map((evt, idx) => (
              <div key={`${evt.timestamp}-${evt.field}-${idx}`} className={`observability-feed-item severity-${evt.severity || 'minor'}`}>
                <span className="observability-feed-time">[{formatTime(evt.timestamp)}]</span>
                <span className="observability-feed-message">{evt.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-secondary italic text-center" style={{ padding: '12px 0' }}>
            Waiting for the first snapshot diff...
          </div>
        )}
      </div>

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
        </>
      )}

      {activeTab === 'IMPACT ANALYSIS' && (
        <>
          <div className="impact-overview-grid">
        {/* Workload Intelligence — with DELTA INDICATORS */}
        <div className="glass-panel impact-workload-panel">
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
          <div className="glass-panel impact-throttle-panel">
            <div className="panel-header">
              <TrendingDown size={18} color="var(--color-red)" /> Throttling &amp; Limitation
            </div>
            <div className="impact-throttle-stats-grid">
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
          </div>
      {/* ═════════════════════════════════════════════════════════════════════
          PREDICTION PANEL — from backend insights (type=prediction)
          ═════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const predictions = (gameState.insights || []).filter(i => i.type === 'prediction');
        const recommendations = (gameState.insights || []).filter(i => i.type === 'recommendation');
        return (
          <div className="simulation-grid impact-forecast-grid" style={{ marginTop: 16 }}>
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
        </>
      )}

      {activeTab === 'KNOWLEDGE BASE' && (
        <>
      {/* ═════════════════════════════════════════════════════════════════════
          KNOWLEDGE PANEL — static educational content
          ═════════════════════════════════════════════════════════════════════ */}
      <KnowledgePanel gameState={gameState} isIarisActive={isIarisActive} />
        </>
      )}

</div>
  );
}

export default App;
