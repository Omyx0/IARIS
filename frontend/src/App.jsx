import { useState, useEffect } from 'react';
import { useWebSocket } from 'react-use-websocket/dist/lib/use-websocket';
import { 
  Activity, 
  Cpu, 
  HardDrive, 
  Server, 
  Wifi, 
  Play, 
  Square,
  Network
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import './index.css';

const WS_URL = 'ws://localhost:8000/ws';
const API_BASE = 'http://localhost:8000/api';

function App() {
  const [gameState, setGameState] = useState({
    system: { cpu_percent: 0, memory_percent: 0, state: 'STABLE', behavior: 'BALANCED' },
    processes: [],
    workloads: [],
    decisions: [],
    dummy_processes: [],
    tick_count: 0
  });

  const [history, setHistory] = useState([]);

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
          setGameState(data);
          
          setHistory(prev => {
            const newHistory = [...prev, {
              time: data.tick_count,
              cpu: data.system.cpu_percent,
              memory: data.system.memory_percent
            }];
            return newHistory.length > 60 ? newHistory.slice(newHistory.length - 60) : newHistory;
          });
        }
      } catch (e) {
        console.error("Failed to parse websocket data", e);
      }
    }
  }, [lastMessage]);

  const spawnDummies = async () => {
    try {
      const response = await fetch(`${API_BASE}/dummy/spawn-demo`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
    } catch (e) {
      console.error('Failed to spawn dummies:', e);
      alert(`Failed to spawn demo load: ${e.message}\n\nMake sure the backend server is running at localhost:8000`);
    }
  };

  const stopAllDummies = async () => {
    try {
      const response = await fetch(`${API_BASE}/dummy`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
    } catch (e) {
      console.error('Failed to stop dummies:', e);
      alert(`Failed to stop dummies: ${e.message}\n\nMake sure the backend server is running at localhost:8000`);
    }
  };

  // Safe checks
  const sys = gameState.system || {};
  const statusClass = `status-${sys.state || 'STABLE'}`;
  
  return (
    <div className="dashboard-container">
      {/* HEADER */}
      <header className="dashboard-header">
        <div className="header-title">
          <Activity className="logo-icon" size={36} />
          <div className="flex-col" style={{ gap: '4px' }}>
            <h1>IARIS Intelligence Hub</h1>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
              Adaptive Resource Allocation & Intent Inference
            </span>
          </div>
          <span className="badge badge-outline" style={{ marginLeft: 24, padding: '6px 12px' }}>
            {readyState === 1 ? <span style={{color: 'var(--accent-green)'}}>● Live Stream Active</span> : <span style={{color: 'var(--accent-magenta)'}}>○ Disconnected</span>}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button className="btn btn-primary" onClick={spawnDummies}>
            <Play size={16} /> Spawn Demo Load
          </button>
          <button className="btn btn-danger" onClick={stopAllDummies}>
            <Square size={16} /> Stop All Dummies
          </button>
        </div>
      </header>

      {/* LEFT SIDEBAR (Metrics & Workloads) */}
      <aside className="left-sidebar">
        {/* System Overview */}
        <div className="glass-panel">
          <div className="panel-header">
            <Server size={18} /> System Overview
          </div>
          
          <div className="metric-grid">
            <div className="metric-card">
              <span className="metric-label flex items-center gap-2"><Cpu size={14}/> CPU Usage</span>
              <span className="metric-value">{sys.cpu_percent?.toFixed(1) || '0.0'}%</span>
              <div className="progress-bar-bg">
                <div 
                  className="progress-bar-fill" 
                  style={{ 
                    width: `${sys.cpu_percent}%`, 
                    background: sys.cpu_percent > 85 ? 'var(--accent-magenta)' : sys.cpu_percent > 60 ? 'var(--accent-yellow)' : 'var(--accent-green)'
                  }} 
                />
              </div>
            </div>
            
            <div className="metric-card">
              <span className="metric-label flex items-center gap-2"><HardDrive size={14}/> Memory</span>
              <span className="metric-value">{sys.memory_percent?.toFixed(1) || '0.0'}%</span>
              <div className="progress-bar-bg">
                <div 
                  className="progress-bar-fill" 
                  style={{ 
                    width: `${sys.memory_percent}%`,
                    background: sys.memory_percent > 85 ? 'var(--accent-magenta)' : sys.memory_percent > 60 ? 'var(--accent-yellow)' : 'var(--accent-green)'
                  }} 
                />
              </div>
              <span className="metric-sub">{sys.memory_available_gb?.toFixed(1)} GB Free</span>
            </div>
          </div>

          <div className={`status-indicator ${statusClass}`}>
            <div className="status-dot"></div>
            <div className="flex-col">
              <span className="status-text">{sys.state || 'UNKNOWN'}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Response: {sys.behavior?.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>
          </div>

          <div className="chart-container">
            {history && history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-magenta)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-magenta)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis domain={[0, 100]} tick={{fontSize: 10, fill: 'var(--text-secondary)'}} stroke="transparent" />
                  <Tooltip 
                    contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                    itemStyle={{ fontSize: 12, fontWeight: 'bold' }}
                  />
                  <Area type="monotone" dataKey="cpu" stroke="var(--accent-cyan)" fillOpacity={1} fill="url(#colorCpu)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="memory" stroke="var(--accent-magenta)" fillOpacity={1} fill="url(#colorMem)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                Waiting for system data...
              </div>
            )}
          </div>
        </div>

        {/* Workload Groups */}
        <div className="glass-panel" style={{ flexGrow: 1 }}>
          <div className="panel-header">
            <Network size={18} /> Workload Groups
          </div>
          <div className="flex-col gap-4">
            {gameState.workloads?.map((w, i) => (
              <div key={i} className="metric-card" style={{ padding: '12px' }}>
                <div className="flex justify-between items-center mb-2">
                  <span style={{ fontWeight: 600 }}>{w.name}</span>
                  <span className="badge badge-outline">{w.member_count} nodes</span>
                </div>
                <div className="flex justify-between metric-sub">
                  <span>Priority: {w.priority.toFixed(1)}</span>
                  <span>CPU: {w.total_cpu.toFixed(1)}%</span>
                </div>
              </div>
            ))}
            {(!gameState.workloads || gameState.workloads.length === 0) && (
              <span className="metric-sub">No workload groups detected.</span>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT (Process Tracking) */}
      <main className="main-content">
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="panel-header">
            <Activity size={18} /> Intelligent Process Tracking
            <span className="badge badge-outline" style={{ marginLeft: 'auto' }}>
              Tracking {sys.process_count || 0} processes
            </span>
          </div>

          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Process / PID</th>
                  <th>Observed Behavior</th>
                  <th>Score</th>
                  <th>CPU %</th>
                  <th>Mem %</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                {gameState.processes?.map(p => (
                  <tr key={p.pid}>
                    <td>
                      <div className="flex-col">
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>PID {p.pid}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge type-${p.behavior_type}`}>
                        {p.behavior_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <span style={{ 
                        color: p.allocation_score >= 0.6 ? 'var(--accent-green)' : 
                               p.allocation_score >= 0.3 ? 'var(--accent-yellow)' : 'var(--accent-magenta)',
                        fontWeight: 'bold',
                        fontFamily: 'monospace'
                      }}>
                        {p.allocation_score.toFixed(3)}
                      </span>
                    </td>
                    <td>{p.avg_cpu.toFixed(1)}</td>
                    <td>{p.avg_memory.toFixed(1)}</td>
                    <td>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {p.observation_count} ticks
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR (Reasoning Timeline) */}
      <aside className="right-sidebar">
        <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header">
            <Wifi size={18} /> Reasoning Engine
          </div>
          
          <div className="timeline">
            {gameState.decisions?.slice().reverse().map((d, i) => (
              <div key={i} className={`timeline-item action-${d.action}`}>
                <div className="timeline-dot"></div>
                <div className="timeline-time">
                  {new Date(d.timestamp * 1000).toLocaleTimeString()} · SCORE: {d.score.toFixed(3)}
                </div>
                <div className="timeline-title">
                  {d.action.toUpperCase()} · {d.process_name}
                </div>
                <div className="timeline-desc">
                  {d.reason}
                </div>
              </div>
            ))}
            {(!gameState.decisions || gameState.decisions.length === 0) && (
              <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: 13 }}>
                Engine is building behavioral profiles. Decisions pending state transition.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default App;
