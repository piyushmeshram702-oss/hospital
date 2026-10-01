// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Page — Overview summary
// Does NOT run its own mic session.
// Direct the user to Live Monitor for actual noise capture.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  MapPin, Wifi, AlertTriangle, AlertOctagon, CheckCircle,
  ChevronRight, Clock, Activity, Mic, Radio
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { getNoiseStatus, secondsSince, formatTime, getStatusColors } from '../utils/noiseUtils';
import NoiseGauge from '../components/NoiseGauge';
import SummaryCard from '../components/SummaryCard';
import NoiseChart from '../components/NoiseChart';
import AlertCard from '../components/AlertCard';
import HospitalFloorMap from '../components/HospitalFloorMap';

export default function DashboardPage() {
  const {
    locations, alerts, selectedLocation, selectedLocationId, setSelectedLocationId,
    readingHistory, acknowledgeAlert, settings, simMode,
  } = useApp();
  const navigate = useNavigate();

  // Summary counts
  const summary = useMemo(() => {
    let normal = 0, warning = 0, critical = 0, offline = 0, devices = 0;
    locations.forEach(loc => {
      const stale = secondsSince(loc.lastUpdated) > settings.staleDataTimeoutSeconds;
      if (loc.currentNoise === null || loc.currentNoise === undefined || stale) { offline++; return; }
      const { status } = getNoiseStatus(loc.currentNoise, loc.warningThreshold, loc.criticalThreshold);
      if (status === 'NORMAL')        normal++;
      else if (status === 'WARNING')  warning++;
      else if (status === 'CRITICAL') critical++;
      if (loc.assignedDeviceId) devices++;
    });
    return { total: locations.length, normal, warning, critical, offline, devices };
  }, [locations, settings.staleDataTimeoutSeconds]);

  const selLocation   = selectedLocation;
  const history       = readingHistory[selectedLocationId] || [];
  const latestReading = history[history.length - 1];
  const stale         = secondsSince(selLocation?.lastUpdated) > settings.staleDataTimeoutSeconds;
  const noiseLevel    = !stale ? selLocation?.currentNoise : null;
  const frequencyHz   = !stale ? selLocation?.currentFrequencyHz : null;
  const dataSource    = selLocation?.dataSource || (simMode ? 'simulation' : null);
  const { status }    = getNoiseStatus(noiseLevel, selLocation?.warningThreshold, selLocation?.criticalThreshold);
  const colors        = getStatusColors(status);
  const recentAlerts  = alerts.slice(0, 5);

  return (
    <div className="p-4 lg:p-6 max-w-screen-xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="text-sm text-slate-400 mt-0.5">Overview — go to Live Monitor to start microphone</p>
        </div>
        <button
          onClick={() => navigate('/live')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition-all active:scale-95 shadow-sm"
        >
          <Mic className="w-4 h-4" />
          Start Monitoring
        </button>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-5">
        <SummaryCard title="Total Locations" value={summary.total}   icon={MapPin}        color="navy"    subtitle={`${summary.devices} with sensors`} />
        <SummaryCard title="Normal"          value={summary.normal}  icon={CheckCircle}   color="emerald" subtitle="Quiet" />
        <SummaryCard title="Warning"         value={summary.warning} icon={AlertTriangle} color="amber"   subtitle="Increasing" />
        <SummaryCard title="High Noise"      value={summary.critical} icon={AlertOctagon} color="red"    subtitle="Action needed" />
        <SummaryCard title="Offline"         value={summary.offline} icon={Wifi}          color="teal"   subtitle="No recent data" />
      </div>

      {/* ── Floor Map ──────────────────────────────────────────────────────── */}
      <div className="card mb-5">
        <HospitalFloorMap
          locations={locations}
          selectedLocationId={selectedLocationId}
          onSelectRoom={setSelectedLocationId}
          staleTimeoutSeconds={settings.staleDataTimeoutSeconds}
        />
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="grid xl:grid-cols-3 gap-5">

        {/* ─ Left col-span-2 ─ */}
        <div className="xl:col-span-2 space-y-5">

          {/* Gauge card */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-800">Live Noise Level</h3>
                <p className="text-xs text-slate-400">
                  {selLocation?.locationName} · Relative noise level (not calibrated dB)
                </p>
              </div>
              <select
                className="select-field w-auto text-sm"
                value={selectedLocationId}
                onChange={e => setSelectedLocationId(e.target.value)}
              >
                {locations.map(l => (
                  <option key={l.locationId} value={l.locationId}>{l.locationName}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex-1 flex justify-center">
                <NoiseGauge
                  noiseLevel={noiseLevel}
                  warningThreshold={selLocation?.warningThreshold}
                  criticalThreshold={selLocation?.criticalThreshold}
                  size="lg"
                  dataSource={dataSource}
                />
              </div>

              <div className="flex-1 space-y-3 w-full">
                {['NORMAL', 'WARNING', 'CRITICAL'].map(s => {
                  const active = status === s && noiseLevel !== null;
                  return (
                    <div key={s} className={`flex items-center gap-3 p-3 rounded-xl transition-all border-2 ${
                      active
                        ? s === 'NORMAL'   ? 'bg-emerald-50 border-emerald-300'
                          : s === 'WARNING'  ? 'bg-amber-50 border-amber-300'
                          : 'bg-red-50 border-red-300'
                        : 'bg-slate-50 border-transparent'
                    }`}>
                      <span className={`w-3 h-3 rounded-full shrink-0 ${
                        s === 'NORMAL'   ? 'bg-emerald-500' :
                        s === 'WARNING'  ? 'bg-amber-500' : 'bg-red-500'
                      } ${active ? 'opacity-100' : 'opacity-20'} ${active && s === 'CRITICAL' ? 'critical-pulse' : ''}`} />
                      <div className="flex-1">
                        <p className={`text-xs font-bold ${active ? 'text-slate-800' : 'text-slate-400'}`}>
                          {s === 'CRITICAL' ? 'HIGH' : s}
                        </p>
                        <p className={`text-xs ${active ? 'text-slate-600' : 'text-slate-300'}`}>
                          {s === 'NORMAL'   ? `0 – ${(selLocation?.warningThreshold || 41) - 1}` :
                           s === 'WARNING'  ? `${selLocation?.warningThreshold || 41} – ${(selLocation?.criticalThreshold || 61) - 1}` :
                                             `≥ ${selLocation?.criticalThreshold || 61}`}
                        </p>
                      </div>
                      {active && <span className="ml-auto text-xs font-black bg-slate-800 text-white px-2 py-0.5 rounded-full">NOW</span>}
                    </div>
                  );
                })}

                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Estimated frequency</p>
                    <p className="mt-1 text-xl font-bold text-slate-800">
                      {frequencyHz > 0 ? `${frequencyHz.toLocaleString()} Hz` : 'No estimate'}
                    </p>
                  </div>
                  <Activity className="h-5 w-5 text-teal-600" aria-hidden="true" />
                </div>

                {latestReading && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                    <Clock className="w-3 h-3" />
                    Last update: {formatTime(latestReading.timestamp)} · {latestReading.source}
                  </p>
                )}

                {noiseLevel === null && (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <p className="text-sm text-slate-400">No live readings for this location.</p>
                    <button
                      onClick={() => navigate('/live')}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white font-bold text-sm hover:bg-teal-700 transition-all"
                    >
                      <Mic className="w-4 h-4" /> Go to Live Monitor
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chart card */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">Noise History</h3>
              <button
                onClick={() => navigate('/analytics')}
                className="text-xs text-navy-600 font-semibold hover:underline flex items-center gap-1"
              >
                Full analytics <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            {history.length > 1 ? (
              <NoiseChart
                data={history.slice(-60)}
                warningThreshold={selLocation?.warningThreshold}
                criticalThreshold={selLocation?.criticalThreshold}
                height={220}
              />
            ) : (
              <div className="h-52 flex flex-col items-center justify-center text-slate-300 gap-3">
                <Activity className="w-10 h-10" />
                <div className="text-center">
                  <p className="text-sm font-semibold">No chart data yet</p>
                  <p className="text-xs">Start microphone or simulation on the Live Monitor page</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─ Right column ─ */}
        <div className="space-y-5">

          {/* Quick start card */}
          <div className="card border-2 border-teal-200 bg-gradient-to-br from-teal-50 to-sky-50">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-teal-100 rounded-xl">
                <Mic className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="font-bold text-slate-800">Start Monitoring</p>
                <p className="text-xs text-slate-500">Use your device microphone</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 mb-3">
              Click below to open the Live Monitor and start capturing noise from your laptop, desktop, or mobile microphone.
            </p>
            <button
              onClick={() => navigate('/live')}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition-all active:scale-95"
            >
              <Mic className="w-4 h-4" />
              Open Live Monitor
            </button>
            <p className="text-xs text-center text-slate-400 mt-2">
              Relative level · Not calibrated dB(A)
            </p>
          </div>

          {/* Recent alerts */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800 text-sm">Recent Alerts</h3>
              <button
                onClick={() => navigate('/alerts')}
                className="text-xs text-navy-600 font-semibold hover:underline flex items-center gap-1"
              >
                All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2.5">
              {recentAlerts.length === 0 ? (
                <div className="text-center py-6 text-slate-300">
                  <CheckCircle className="w-8 h-8 mx-auto mb-1.5" />
                  <p className="text-sm">No alerts — all clear!</p>
                </div>
              ) : recentAlerts.map(alert => (
                <AlertCard key={alert.alertId} alert={alert} onAcknowledge={acknowledgeAlert} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
