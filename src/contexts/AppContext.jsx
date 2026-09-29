// ─────────────────────────────────────────────────────────────────────────────
// App Context — Global State Management
// Manages locations, alerts, simulation, and settings
// ─────────────────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { DEMO_LOCATIONS, DEMO_DEVICES, generateDemoAlerts } from '../utils/demoData';
import { generateSimulatedNoise, getNoiseStatus, generateId, formatDuration } from '../utils/noiseUtils';
import { isFirebaseConfigured } from '../firebase/config';
import { subscribeToLocations, subscribeToAlerts, subscribeToDevices, createAlert, acknowledgeAlert as fbAcknowledgeAlert } from '../firebase/firestoreService';

const AppContext = createContext(null);

// Track when this browser session started — overlay only fires for NEW alerts
const SESSION_START = Date.now();

export function AppProvider({ children }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [locations, setLocations]             = useState(DEMO_LOCATIONS);
  const [devices, setDevices]                 = useState(DEMO_DEVICES);
  const [alerts, setAlerts]                   = useState(generateDemoAlerts());
  const [selectedLocationId, setSelectedLocationId] = useState('ROOM_101');
  const [monitoringMode, setMonitoringMode]   = useState('hospital'); // 'hospital' | 'general'
  const [usingFirebase, setUsingFirebase]     = useState(false);

  // Simulation state
  const [simMode, setSimMode]                 = useState(false);
  const [simScenario, setSimScenario]         = useState('random'); // 'normal'|'warning'|'critical'|'random'
  const simIntervalRef = useRef(null);

  // Per-location reading history (in-memory, last 120 data points)
  const [readingHistory, setReadingHistory]   = useState({});

  // Alert threshold timer refs: locationId → { count, startTime }
  const alertTimerRef = useRef({});

  // Settings
  const [settings, setSettings] = useState({
    alertDurationSeconds: 10,
    staleDataTimeoutSeconds: 30,
    audioAlertsEnabled: false,
    simulationIntervalMs: 2000,
    saveToFirebase: true,
    maxHistoryPoints: 120,
  });

  // ── Firebase listeners ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    setUsingFirebase(true);

    const unsubLoc = subscribeToLocations(locs => {
      if (locs.length > 0) setLocations(locs);
    });
    const unsubAlerts = subscribeToAlerts(als => setAlerts(als));
    const unsubDevices = subscribeToDevices(devs => {
      if (devs.length > 0) setDevices(devs);
    });

    return () => { unsubLoc(); unsubAlerts(); unsubDevices(); };
  }, []);

  // ── Derived helpers ────────────────────────────────────────────────────────
  const normalizeLocationKey = useCallback((value) => {
    return String(value ?? '').trim().replace(/\s+/g, '_').toUpperCase();
  }, []);

  const getLocation = useCallback((id) => {
    const target = normalizeLocationKey(id);
    return locations.find(l =>
      normalizeLocationKey(l.locationId) === target ||
      normalizeLocationKey(l.locationName) === target
    );
  }, [locations, normalizeLocationKey]);
  const selectedLocation = getLocation(selectedLocationId) || locations[0];

  // ── Trigger and save an alert ─────────────────────────────────────────────
  const triggerAlert = useCallback(async (locationId, noiseLevel, severity, locationName, source) => {
    const newAlert = {
      alertId: generateId(),
      locationId,
      locationName,
      noiseLevel,
      severity,
      message: severity === 'CRITICAL'
        ? 'NOISE TOO LOUD! Please Maintain Silence'
        : 'Noise Level is Increasing',
      acknowledged: false,
      createdAt: new Date(),
      acknowledgedAt: null,
      source,
    };

    setAlerts(prev => [newAlert, ...prev]);

    if (isFirebaseConfigured && settings.saveToFirebase) {
      try { await createAlert(newAlert); } catch (_) { /* best-effort */ }
    }
  }, [settings.saveToFirebase]);

  // ── Ingest a noise reading (from simulation OR hardware API) ───────────────
  const ingestReading = useCallback((locationId, noiseLevel, source = 'simulation') => {
    const timestamp = new Date();
    const targetLocation = getLocation(locationId);
    if (!targetLocation) return { success: false, error: 'Location not found' };

    const loc = targetLocation;
    const targetLocationId = loc.locationId;
    const wt = loc.warningThreshold  || 41;
    const ct = loc.criticalThreshold || 61;
    const { status } = getNoiseStatus(noiseLevel, wt, ct);

    // Update location's current noise
    setLocations(prev => prev.map(l =>
      l.locationId === targetLocationId
        ? { ...l, currentNoise: noiseLevel, lastUpdated: timestamp, dataSource: source }
        : l
    ));

    // Append to history
    setReadingHistory(prev => {
      const existing = prev[targetLocationId] || [];
      const updated  = [...existing, { timestamp, noiseLevel, source }];
      return { ...prev, [targetLocationId]: updated.slice(-settings.maxHistoryPoints) };
    });

    // Alert threshold logic — require sustained duration
    if (status === 'WARNING' || status === 'CRITICAL') {
      const key = targetLocationId;
      if (!alertTimerRef.current[key]) {
        alertTimerRef.current[key] = { status, startTime: timestamp, triggered: false };
      } else {
        const elapsed = (timestamp - alertTimerRef.current[key].startTime) / 1000;
        if (!alertTimerRef.current[key].triggered && elapsed >= settings.alertDurationSeconds) {
          alertTimerRef.current[key].triggered = true;
          triggerAlert(targetLocationId, noiseLevel, status, loc.locationName, source);
        }
      }
    } else {
      // Reset timer if noise dropped back to normal
      delete alertTimerRef.current[targetLocationId];
    }

    return { success: true, locationId: targetLocationId, noiseLevel };
  }, [getLocation, settings.alertDurationSeconds, settings.maxHistoryPoints, triggerAlert]);

  // ── Acknowledge alert ─────────────────────────────────────────────────────
  const acknowledgeAlert = useCallback(async (alertId) => {
    const now = new Date();
    setAlerts(prev => prev.map(a =>
      a.alertId === alertId ? { ...a, acknowledged: true, acknowledgedAt: now } : a
    ));
    // Reset alert timer so another alert can fire later
    const alert = alerts.find(a => a.alertId === alertId);
    if (alert) delete alertTimerRef.current[alert.locationId];

    if (isFirebaseConfigured) {
      try { await fbAcknowledgeAlert(alertId); } catch (_) {}
    }
  }, [alerts]);

  // ── Simulation engine ─────────────────────────────────────────────────────
  const startSimulation = useCallback((scenario = 'random', locationId = null) => {
    setSimMode(true);
    setSimScenario(scenario);
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);

    const targetLocId = locationId || selectedLocationId;

    simIntervalRef.current = setInterval(() => {
      const noise = generateSimulatedNoise(scenario);
      ingestReading(targetLocId, noise, 'simulation');
    }, settings.simulationIntervalMs);
  }, [selectedLocationId, settings.simulationIntervalMs, ingestReading]);

  const stopSimulation = useCallback(() => {
    setSimMode(false);
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
  }, []);

  const changeSimScenario = useCallback((scenario) => {
    setSimScenario(scenario);
    if (simMode) {
      stopSimulation();
      startSimulation(scenario);
    }
  }, [simMode, stopSimulation, startSimulation]);

  // Cleanup on unmount
  useEffect(() => () => { if (simIntervalRef.current) clearInterval(simIntervalRef.current); }, []);

  // ── Update settings ───────────────────────────────────────────────────────
  const updateSettings = useCallback((updates) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  // ── Update a location (local + Firebase) ──────────────────────────────────
  const updateLocationLocal = useCallback((locationId, updates) => {
    setLocations(prev => prev.map(l => l.locationId === locationId ? { ...l, ...updates } : l));
  }, []);

  const addLocationLocal = useCallback((loc) => {
    setLocations(prev => [...prev, { ...loc, locationId: generateId(), currentNoise: null, lastUpdated: null }]);
  }, []);

  const deleteLocationLocal = useCallback((locationId) => {
    setLocations(prev => prev.filter(l => l.locationId !== locationId));
    if (selectedLocationId === locationId) setSelectedLocationId(locations[0]?.locationId);
  }, [selectedLocationId, locations]);

  // ── Hardware ingestion endpoint (called by ESP32 HTTP handler) ────────────
  const ingestHardwareReading = useCallback((payloadOrLocationId, maybeNoiseLevel, maybeSource) => {
    const payload = typeof payloadOrLocationId === 'object' && payloadOrLocationId !== null
      ? payloadOrLocationId
      : { locationId: payloadOrLocationId, noiseLevel: maybeNoiseLevel, source: maybeSource || 'hardware' };

    if (!payload || typeof payload.noiseLevel !== 'number') {
      console.warn('[Hardware] Invalid payload:', payloadOrLocationId);
      return { success: false, error: 'Invalid payload' };
    }

    const locationId = payload.locationId ?? payload.roomId;
    const noiseLevel = Number(payload.noiseLevel);
    const source = payload.source || maybeSource || 'hardware';

    if (!locationId || typeof locationId !== 'string' || !String(locationId).trim()) {
      console.warn('[Hardware] Missing locationId:', payload);
      return { success: false, error: 'Missing locationId' };
    }

    if (noiseLevel < 0 || noiseLevel > 200) {
      return { success: false, error: 'Noise level out of range' };
    }

    return ingestReading(locationId, Math.round(noiseLevel), source);
  }, [ingestReading]);

  // ── Context value ─────────────────────────────────────────────────────────
  // Only alerts created AFTER session start trigger the critical overlay.
  // Pre-loaded demo/historical alerts are never shown as a live emergency.
  const sessionAlerts = alerts.filter(
    a => new Date(a.createdAt).getTime() >= SESSION_START
  );

  return (
    <AppContext.Provider value={{
      // Data
      locations, devices, alerts, readingHistory,
      sessionAlerts,          // ← only current-session alerts
      // Selection
      selectedLocationId, setSelectedLocationId,
      selectedLocation,
      monitoringMode, setMonitoringMode,
      // Simulation
      simMode, simScenario,
      startSimulation, stopSimulation, changeSimScenario,
      // Actions
      ingestReading,
      ingestHardwareReading,
      acknowledgeAlert,
      addLocationLocal, updateLocationLocal, deleteLocationLocal,
      // Settings
      settings, updateSettings,
      // Status
      usingFirebase,
      getLocation,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
