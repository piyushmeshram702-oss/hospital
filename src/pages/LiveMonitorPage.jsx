// ─────────────────────────────────────────────────────────────────────────────
// Live Monitor Page — Primary noise monitoring interface
// Supports: Built-in mic, External mic, Simulation demo
//
// DISCLAIMER: Relative noise level (0–100). NOT calibrated dB(A).
// Accuracy depends on device microphone hardware.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Square, Maximize2, Radio, AlertTriangle,
  Info, SlidersHorizontal, Cpu, CheckCircle, Zap, RefreshCw,
  Volume2, Clock, Activity
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { useMicrophone } from '../hooks/useMicrophone';
import { getNoiseStatus, getStatusColors, secondsSince, formatTime, generateSimulatedNoise } from '../utils/noiseUtils';
import NoiseGauge from '../components/NoiseGauge';
import NoiseChart from '../components/NoiseChart';

// ── Animated waveform bars (RAF-driven) ───────────────────────────────────────
function WaveformBars({ active, level = 0, bars = 20 }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf;
    const loop = () => { setFrame(n => n + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="flex items-end justify-center gap-[2px]" style={{ height: 40 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const phase = i / bars;
        const h = active
          ? Math.max(3, Math.round(
              (level / 100) * 36 * (0.25 + 0.75 * Math.abs(Math.sin(frame / 8 + phase * Math.PI * 2)))
            ))
          : 3;
        return (
          <div
            key={i}
            className={`rounded-full transition-none ${active ? 'bg-teal-500' : 'bg-slate-200'}`}
            style={{ width: 3, height: h }}
          />
        );
      })}
    </div>
  );
}

// ── Horizontal level bar with threshold ticks ─────────────────────────────────
function LevelBar({ level, warnAt, critAt, height = 'h-5' }) {
  const pct     = Math.min(100, level || 0);
  const warnPct = Math.min(98, (warnAt / 100) * 100);
  const critPct = Math.min(98, (critAt / 100) * 100);
  const color   = pct >= critAt ? 'bg-red-500' : pct >= warnAt ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div>
      <div className={`relative ${height} bg-slate-100 rounded-full overflow-visible`}>
        <div
          className={`${height} rounded-full transition-all duration-100 ${color}`}
          style={{ width: `${pct}%` }}
        />
        {/* Threshold ticks */}
        <div className="absolute top-0 h-full w-0.5 bg-amber-400 opacity-90 z-10"
          style={{ left: `${warnPct}%` }} title={`Warning ≥ ${warnAt}`} />
        <div className="absolute top-0 h-full w-0.5 bg-red-500 opacity-90 z-10"
          style={{ left: `${critPct}%` }} title={`Critical ≥ ${critAt}`} />
      </div>
      <div className="flex justify-between text-xs mt-0.5 px-0.5">
        <span className="text-slate-400">0</span>
        <span className="text-amber-500 font-semibold">{warnAt}</span>
        <span className="text-red-500 font-semibold">{critAt}</span>
        <span className="text-slate-400">100</span>
      </div>
    </div>
  );
}

// ── Status row pill ───────────────────────────────────────────────────────────
function StatusRow({ status, noiseLevel, warnAt, critAt }) {
  const zones = [
    { key: 'NORMAL',   label: 'NORMAL',   range: `0 – ${warnAt - 1}`,      color: 'emerald', msg: 'Environment is quiet.' },
    { key: 'WARNING',  label: 'WARNING',  range: `${warnAt} – ${critAt - 1}`, color: 'amber', msg: 'Noise level is increasing.' },
    { key: 'CRITICAL', label: 'HIGH',     range: `≥ ${critAt}`,             color: 'red',     msg: 'Please reduce noise!' },
  ];

  return (
    <div className="space-y-2">
      {zones.map(z => {
        const active = status === z.key && noiseLevel !== null;
        const bg     = active
          ? z.color === 'emerald' ? 'bg-emerald-50 border-2 border-emerald-300'
            : z.color === 'amber'   ? 'bg-amber-50 border-2 border-amber-300'
            : 'bg-red-50 border-2 border-red-300'
          : 'bg-slate-50 border-2 border-transparent';
        const dot = z.color === 'emerald' ? 'bg-emerald-500'
          : z.color === 'amber' ? 'bg-amber-500' : 'bg-red-500';
        const text = active
          ? z.color === 'emerald' ? 'text-emerald-800' : z.color === 'amber' ? 'text-amber-800' : 'text-red-800'
          : 'text-slate-400';

        return (
          <div key={z.key} className={`flex items-center gap-3 p-3 rounded-xl transition-all ${bg}`}>
            <span className={`w-3 h-3 rounded-full flex-none ${dot} ${!active ? 'opacity-20' : ''} ${active && z.key === 'CRITICAL' ? 'critical-pulse' : ''}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold ${text}`}>{z.label}</p>
              <p className={`text-xs truncate ${active ? text : 'text-slate-300'}`}>
                {z.range} · {z.msg}
              </p>
            </div>
            {active && <span className="text-xs font-black bg-slate-800 text-white px-2 py-0.5 rounded-full">NOW</span>}
          </div>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════
const SOURCE_TABS = [
  { key: 'microphone', label: 'Microphone', icon: Mic,  desc: 'Your device microphone' },
  { key: 'hardware', label: 'Grove / Arduino', icon: Cpu, desc: 'Real sound sensor' },
  { key: 'simulation', label: 'Simulation', icon: Zap,  desc: 'Demo mode — no hardware' },
];

export default function LiveMonitorPage() {
  const {
    locations, selectedLocationId, setSelectedLocationId,
    readingHistory, settings, simMode, stopSimulation, ingestReading,
  } = useApp();
  const navigate = useNavigate();

  const {
    micState, micLevel, micError, micDevice, micLabel,
    devices: micDevices, deviceId, setDeviceId,
    startMicrophone, stopMicrophone, setGain,
    isActive, isRequesting, isError,
  } = useMicrophone();

  const [sourceTab,   setSourceTab]   = useState('microphone');
  const [sensitivity, setSensitivity] = useState(22);
  const [simScenario, setSimScenario] = useState('random');
  const simRef = useRef(null);
  const [, forceUpdate] = useState(0);

  // Refresh display every second (for stale timer)
  useEffect(() => {
    const t = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-set sensitivity when mic type detected
  useEffect(() => {
    if (micDevice === 'external') { setSensitivity(8); setGain(8); }
    else if (micDevice === 'builtin') { setSensitivity(22); setGain(22); }
  }, [micDevice, setGain]);

  // When switching tabs, stop previous source
  const switchTab = useCallback((tab) => {
    if (tab === 'microphone' && sourceTab === 'simulation') {
      clearInterval(simRef.current);
      simRef.current = null;
      if (simMode) stopSimulation();
    }
    if (tab === 'simulation' && sourceTab === 'microphone') {
      stopMicrophone();
    }
    setSourceTab(tab);
  }, [sourceTab, simMode, stopSimulation, stopMicrophone]);

  // Microphone start
  const handleStartMic = async () => {
    await startMicrophone((level) => {
      ingestReading(selectedLocationId, level, 'microphone');
    }, sensitivity);
  };

  // Local simulation (not global — scoped to this page)
  const handleStartSim = (scenario) => {
    clearInterval(simRef.current);
    setSimScenario(scenario);
    simRef.current = setInterval(() => {
      ingestReading(selectedLocationId, generateSimulatedNoise(scenario), 'simulation');
    }, settings.simulationIntervalMs);
  };

  const handleStopSim = () => {
    clearInterval(simRef.current);
    simRef.current = null;
    setSimScenario('random');
  };

  const handleSendGroveTest = async () => {
    try {
      const payload = {
        deviceId: 'GROVE_SOUND_01',
        locationId: selectedLocationId,
        noiseLevel: 56,
        deviceName: 'Grove Sound Sensor',
        status: 'WARNING',
        timestamp: new Date().toISOString(),
      };

      const response = await fetch('http://localhost:3001/reading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Sensor relay rejected the reading');
      }
    } catch (error) {
      console.error('[Grove] Test reading failed:', error);
    }
  };

  const simRunning = !!simRef.current;

  // Cleanup on unmount
  useEffect(() => () => { clearInterval(simRef.current); }, []);

  // Location & data
  const location    = locations.find(l => l.locationId === selectedLocationId) || locations[0];
  const history     = readingHistory[selectedLocationId] || [];
  const stale       = secondsSince(location?.lastUpdated) > settings.staleDataTimeoutSeconds;

  // Display level: prefer live mic, then history
  const noiseLevel = isActive
    ? micLevel
    : (!stale && location?.currentNoise !== null && location?.currentNoise !== undefined
      ? location.currentNoise : null);

  const dataSource = isActive ? 'microphone' : (simRunning ? 'simulation' : null);
  const warnAt     = location?.warningThreshold  || 41;
  const critAt     = location?.criticalThreshold || 61;
  const { status } = getNoiseStatus(noiseLevel, warnAt, critAt);
  const colors     = getStatusColors(status);

  const avg = history.length ? Math.round(history.reduce((s, r) => s + r.noiseLevel, 0) / history.length) : null;
  const max = history.length ? Math.max(...history.map(r => r.noiseLevel)) : null;

  return (
    <div className="p-4 lg:p-6 max-w-screen-2xl mx-auto">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="page-title flex items-center gap-2">
            <Radio className="w-6 h-6 text-emerald-500" />
            Live Monitor
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Relative noise level · Not calibrated dB(A) · For informational use only
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Source indicator pill */}
          {dataSource && (
            <span className={`hidden sm:flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${
              dataSource === 'microphone' ? 'bg-teal-50 text-teal-700 border-teal-200'
              : 'bg-purple-50 text-purple-700 border-purple-200'
            }`}>
              <span className="w-1.5 h-1.5 rounded-full live-dot bg-current" />
              {dataSource === 'microphone' ? '🎤 MIC LIVE' : '⚡ SIMULATION'}
            </span>
          )}
          <button
            onClick={() => navigate('/fullscreen')}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
            title="Full-screen display mode"
          >
            <Maximize2 className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      {/* ── Location + stale warning ─────────────────────────────────────────── */}
      <div className="card mb-5 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-48">
          <label className="label">Monitoring Location</label>
          <select
            className="select-field text-sm"
            value={selectedLocationId}
            onChange={e => setSelectedLocationId(e.target.value)}
          >
            {locations.map(l => (
              <option key={l.locationId} value={l.locationId}>{l.locationName}</option>
            ))}
          </select>
        </div>
        {stale && location?.lastUpdated && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-semibold">Stale — last update {formatTime(location.lastUpdated)}</span>
          </div>
        )}
      </div>

      {/* ── Main 3-column grid ───────────────────────────────────────────────── */}
      <div className="grid xl:grid-cols-3 gap-5">

        {/* ═══ LEFT col-span-2 ══════════════════════════════════════════════════ */}
        <div className="xl:col-span-2 space-y-5">

          {/* Gauge card */}
          <div className={`card transition-all duration-500 ${
            noiseLevel !== null && status === 'CRITICAL' ? 'ring-2 ring-red-400 shadow-red-100 shadow-lg'
            : noiseLevel !== null && status === 'WARNING' ? 'ring-2 ring-amber-400'
            : isActive ? 'ring-2 ring-teal-300' : ''
          }`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-slate-800">{location?.locationName}</h3>
                <p className="text-xs text-slate-400 capitalize">
                  {location?.locationType?.replace('_', ' ')} · Relative noise level
                </p>
              </div>
              {location?.lastUpdated && !stale && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Clock className="w-3.5 h-3.5" /> {formatTime(location.lastUpdated)}
                </div>
              )}
            </div>

            {/* Mic active strip */}
            {isActive && (
              <div className={`p-3 rounded-xl mb-4 border ${
                status === 'CRITICAL' ? 'bg-red-50 border-red-200'
                : status === 'WARNING' ? 'bg-amber-50 border-amber-200'
                : 'bg-teal-50 border-teal-200'
              }`}>
                <div className="flex items-center gap-3 mb-2">
                  <Mic className={`w-5 h-5 shrink-0 ${colors.text} ${status === 'CRITICAL' ? 'critical-pulse' : ''}`} />
                  <WaveformBars active={true} level={micLevel || 0} />
                  <div className="ml-auto text-right">
                    <p className={`text-4xl font-black leading-none ${colors.text}`}>{micLevel ?? 0}</p>
                    <p className="text-xs text-slate-500 font-semibold">Rel. Level</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="w-2 h-2 rounded-full bg-teal-500 live-dot" />
                    <span className="text-xs font-bold text-teal-700 mt-0.5">LIVE</span>
                  </div>
                </div>
                {/* Mic device */}
                {micDevice !== 'unknown' && (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    micDevice === 'external' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    <Cpu className="w-3 h-3" />
                    {micDevice === 'external' ? '🎧 External / Earbuds' : '💻 Built-in Microphone'}
                    {micLabel ? ` — ${micLabel.slice(0, 40)}` : ''}
                  </span>
                )}
                {/* Sensitivity */}
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-slate-500 mb-0.5">
                    <span className="flex items-center gap-1"><SlidersHorizontal className="w-3 h-3" /> Sensitivity</span>
                    <span className="font-mono">{sensitivity}×</span>
                  </div>
                  <input type="range" min={1} max={50} step={1}
                    value={sensitivity}
                    onChange={e => { const v = Number(e.target.value); setSensitivity(v); setGain(v); }}
                    className="w-full accent-teal-500 h-1.5 cursor-pointer"
                  />
                  {noiseLevel === 0 && isActive && (
                    <p className="text-xs text-amber-600 font-semibold mt-1">
                      Reading is 0 — try sliding sensitivity to the right →
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Level bar */}
            {noiseLevel !== null && (
              <div className="mb-4">
                <LevelBar level={noiseLevel} warnAt={warnAt} critAt={critAt} />
              </div>
            )}

            {/* Gauge + status */}
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex-1 flex justify-center">
                <NoiseGauge
                  noiseLevel={noiseLevel}
                  warningThreshold={warnAt}
                  criticalThreshold={critAt}
                  size="lg"
                  dataSource={dataSource}
                />
              </div>
              <div className="flex-1 w-full">
                <StatusRow status={status} noiseLevel={noiseLevel} warnAt={warnAt} critAt={critAt} />
                {/* Alert hint */}
                {isActive && noiseLevel !== null && (status === 'WARNING' || status === 'CRITICAL') && (
                  <div className={`mt-2 flex items-center gap-2 p-2 rounded-lg text-xs font-semibold ${
                    status === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Alert fires after {settings.alertDurationSeconds}s sustained {status.toLowerCase()} noise
                  </div>
                )}
                {/* Privacy */}
                {isActive && (
                  <p className="mt-2 flex items-start gap-1 text-xs text-slate-400">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    Audio processed locally — no recordings stored or transmitted
                  </p>
                )}
                {/* Last reading */}
                {history.length > 0 && (
                  <p className="mt-2 text-xs text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Last: {formatTime(history[history.length - 1]?.timestamp)}
                  </p>
                )}
              </div>
            </div>

            {/* Mic CTA when idle */}
            {!isActive && !simRunning && (
              <div className="mt-5 flex flex-col sm:flex-row items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-teal-50 to-sky-50 border border-teal-100">
                <Mic className="w-8 h-8 text-teal-500" />
                <div>
                  <p className="font-bold text-slate-800 text-sm">Start monitoring with your microphone</p>
                  <p className="text-xs text-slate-500">Click "Start Microphone" in the panel on the right</p>
                </div>
                <button
                  onClick={handleStartMic}
                  disabled={isRequesting}
                  className="sm:ml-auto shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition-all active:scale-95"
                >
                  <Mic className="w-4 h-4" />
                  {isRequesting ? 'Requesting…' : 'Start Microphone'}
                </button>
              </div>
            )}
          </div>

          {/* Chart card */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-800">Noise History</h3>
                {isActive && <p className="text-xs text-teal-600 font-semibold">🎤 Recording live</p>}
                {simRunning && <p className="text-xs text-purple-600 font-semibold">⚡ Simulation running</p>}
              </div>
              <span className="text-xs text-slate-400">{history.length} readings</span>
            </div>
            {history.length > 1 ? (
              <NoiseChart
                data={history.slice(-100)}
                warningThreshold={warnAt}
                criticalThreshold={critAt}
                height={240}
              />
            ) : (
              <div className="h-56 flex flex-col items-center justify-center gap-3 text-slate-300">
                <Activity className="w-12 h-12" />
                <p className="text-sm">Start microphone or simulation to see chart</p>
              </div>
            )}
            {/* Session stats */}
            {history.length > 3 && (
              <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-50">
                {[
                  { label: 'Average', val: avg, color: 'text-blue-600' },
                  { label: 'Maximum', val: max, color: 'text-red-600' },
                  { label: 'Minimum', val: Math.min(...history.map(r => r.noiseLevel)), color: 'text-emerald-600' },
                  { label: 'Readings', val: history.length, color: 'text-slate-700' },
                ].map(({ label, val, color }) => (
                  <div key={label} className="text-center p-2 rounded-xl bg-slate-50">
                    <p className={`text-xl font-black ${color}`}>{val ?? '—'}</p>
                    <p className="text-xs text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══ RIGHT column ═════════════════════════════════════════════════════ */}
        <div className="space-y-4">

          {/* Source selector */}
          <div className="card">
            <h3 className="font-bold text-slate-800 mb-3 text-sm">Data Source</h3>
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-4">
              {SOURCE_TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => switchTab(key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all ${
                    sourceTab === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            {/* Microphone panel */}
            {sourceTab === 'microphone' && (
              <div className="space-y-3">
                {/* Device selector */}
                {micDevices.length > 1 && (
                  <div>
                    <label className="label text-xs">Microphone Device</label>
                    <select
                      className="select-field text-sm"
                      value={deviceId || ''}
                      onChange={e => setDeviceId(e.target.value || null)}
                    >
                      <option value="">Default (system selection)</option>
                      {micDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">Requires microphone permission to list devices</p>
                  </div>
                )}

                {/* Privacy notice */}
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-50 border border-blue-100">
                  <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-600">
                    <strong>Privacy:</strong> Audio stays on your device. Only relative noise numbers are used. Nothing is recorded.
                  </p>
                </div>

                {/* Error */}
                {isError && micError && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                    <p className="text-sm font-bold text-red-700 mb-1">Could not start microphone</p>
                    <p className="text-xs text-red-600">{micError}</p>
                    <button
                      onClick={handleStartMic}
                      className="mt-2 text-xs text-red-600 underline font-semibold flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Try again
                    </button>
                  </div>
                )}

                {/* Waveform */}
                <div className="flex justify-center py-2">
                  <WaveformBars active={isActive} level={micLevel || 0} bars={16} />
                </div>

                {/* Pre-start sensitivity */}
                {!isActive && (
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Starting Sensitivity</span>
                      <span className="font-mono">{sensitivity}×</span>
                    </div>
                    <input type="range" min={1} max={50} step={1}
                      value={sensitivity}
                      onChange={e => setSensitivity(Number(e.target.value))}
                      className="w-full accent-teal-500 h-1.5 cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-slate-300 mt-0.5">
                      <span>Low (earbuds)</span>
                      <span>High (built-in)</span>
                    </div>
                  </div>
                )}

                {/* Start/stop button */}
                {!isActive ? (
                  <button
                    onClick={handleStartMic}
                    disabled={isRequesting}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-base transition-all ${
                      isRequesting
                        ? 'bg-slate-100 text-slate-400 cursor-wait'
                        : 'bg-teal-600 hover:bg-teal-700 text-white active:scale-95 shadow-sm'
                    }`}
                  >
                    <Mic className="w-5 h-5" />
                    {isRequesting ? 'Requesting permission…' : 'Start Microphone'}
                  </button>
                ) : (
                  <button
                    onClick={stopMicrophone}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-base transition-all active:scale-95"
                  >
                    <Square className="w-5 h-5" />
                    Stop Microphone
                  </button>
                )}

                <p className="text-xs text-center text-slate-400">
                  Relative level · Not calibrated dB(A) · Accuracy varies by device
                </p>
              </div>
            )}

            {/* Hardware / Grove panel */}
            {sourceTab === 'hardware' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                  <Cpu className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700">
                    <strong>Arduino + Grove sensor</strong> — connect a real sound sensor to the Uno and send readings to the local relay.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
                  <p><span className="font-bold text-slate-700">1.</span> Connect the Grove sound sensor to A0 on the Arduino Uno.</p>
                  <p><span className="font-bold text-slate-700">2.</span> Upload the sample sketch from the project README.</p>
                  <p><span className="font-bold text-slate-700">3.</span> Run <span className="font-mono bg-slate-200 px-1 rounded">node relay-server.js</span> and then the bridge script.</p>
                </div>

                <button
                  onClick={handleSendGroveTest}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all active:scale-95"
                >
                  <Cpu className="w-4 h-4" /> Send Test Grove Reading
                </button>

                <p className="text-xs text-center text-slate-400">
                  Use <span className="font-mono text-slate-500">http://localhost:3001/reading</span> as the sensor endpoint.
                </p>
              </div>
            )}

            {/* Simulation panel */}
            {sourceTab === 'simulation' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-purple-50 border border-purple-100">
                  <Zap className="w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-purple-600">
                    <strong>SIMULATION MODE</strong> — generates demo values. No real microphone is used.
                    Never mix simulation with actual readings.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'normal',   label: '✓ Normal',   color: 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100' },
                    { key: 'warning',  label: '⚠ Warning',  color: 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100' },
                    { key: 'critical', label: '🔴 High',     color: 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100' },
                    { key: 'random',   label: '🎲 Random',   color: 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100' },
                  ].map(s => (
                    <button
                      key={s.key}
                      onClick={() => { handleStartSim(s.key); }}
                      className={`py-2.5 px-3 rounded-xl border-2 font-bold text-xs transition-all active:scale-95 ${s.color} ${simRunning && simScenario === s.key ? 'ring-2 ring-offset-1 ring-current' : ''}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {simRunning ? (
                  <button
                    onClick={handleStopSim}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition-all active:scale-95"
                  >
                    <Square className="w-4 h-4" /> Stop Simulation
                  </button>
                ) : (
                  <button
                    onClick={() => handleStartSim('random')}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm transition-all active:scale-95"
                  >
                    <Zap className="w-4 h-4" /> Start Simulation
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Thresholds info */}
          <div className="card">
            <h3 className="font-bold text-slate-800 mb-3 text-sm">Alert Thresholds</h3>
            <div className="space-y-2">
              {[
                { label: 'Normal',  range: `0 – ${warnAt - 1}`,         color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                { label: 'Warning', range: `${warnAt} – ${critAt - 1}`, color: 'bg-amber-50 border-amber-200 text-amber-700' },
                { label: 'High',    range: `≥ ${critAt}`,               color: 'bg-red-50 border-red-200 text-red-700' },
              ].map(({ label, range, color }) => (
                <div key={label} className={`flex justify-between items-center p-2.5 rounded-lg border ${color}`}>
                  <span className="text-xs font-bold">{label}</span>
                  <span className="text-xs font-semibold">{range}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Alert fires after {settings.alertDurationSeconds}s sustained breach. Configure in{' '}
              <a href="/settings" className="underline text-navy-600 font-semibold">Settings</a>.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              ⚠ These are illustrative levels only, not medical or regulatory standards.
            </p>
          </div>

          {/* Fullscreen shortcut */}
          <button
            onClick={() => navigate('/fullscreen')}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-navy-800 hover:bg-navy-900 text-white font-bold text-sm transition-all active:scale-95"
          >
            <Maximize2 className="w-4 h-4" />
            Open Full-Screen Display
          </button>
        </div>
      </div>
    </div>
  );
}
