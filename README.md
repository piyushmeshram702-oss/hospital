# Smart Noise Monitor

A real-time environmental noise monitoring system for hospitals and general environments. Built for a 36-hour hackathon.

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (runs on http://localhost:3000)
npm run dev
```

The app **works immediately in demo mode** without any Firebase or hardware configuration.

---

## Running Simulation Mode

1. Open the app at `http://localhost:3000`
2. Go to the **Dashboard** or **Live Monitor** page
3. Click **Start Simulation** in the Simulation Engine panel
4. Select a scenario: **Normal**, **Warning**, **Critical**, or **Random**
5. Watch the gauge, chart, and alerts update in real time
6. A **SIMULATION MODE** badge appears in the header and sidebar

---

## Grove / Arduino Uno Sound Sensor Setup

This project can also accept live readings from a Grove analog sound sensor connected to an Arduino Uno.

### 1) Connect the hardware

Typical wiring:
- Grove sound sensor VCC → 5V
- Grove sound sensor GND → GND
- Grove sound sensor SIG / OUT → A0 on the Uno

### 2) Upload this sketch to the Arduino Uno

```cpp
const int soundPin = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(soundPin);
  int mapped = map(raw, 0, 1023, 0, 100);
  Serial.println(mapped);
  delay(2000);
}
```

### 3) Run the serial bridge on your Mac

From the project folder:

```bash
node serial-bridge.js --port=/dev/cu.usbmodem1101 --location=ROOM_101 --deviceId=GROVE_SOUND_01
```

If the port name is different, replace it with the port shown in Arduino IDE or `ls /dev/cu.*`.

The bridge sends each reading to the relay at `http://localhost:3001/reading`.

### 4) Start the relay and dashboard

```bash
node relay-server.js
npm run dev -- --host 0.0.0.0 --port 3000
```

Then open the dashboard and the room will update from the Arduino/Grove sensor instead of the Mac microphone.

---

## Firebase Setup (Optional)

The app runs fully in demo mode without Firebase. To enable cloud persistence:

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore Database** and **Authentication**
3. Copy `.env.example` to `.env.local`
4. Fill in your Firebase project credentials
5. Restart the dev server

### Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /noise_readings/{id} {
      allow read: if request.auth != null;
      allow write: if true; // Allow ESP32 writes (add API key auth for production)
    }
    match /alerts/{id} {
      allow read, write: if request.auth != null;
    }
    match /locations/{id} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /devices/{id} {
      allow read, write: if true;
    }
  }
}
```

---

## Connecting ESP32 Hardware

### Ingestion API

Your ESP32 device should send a POST request with this JSON payload:

```json
{
  "deviceId": "ESP32_ROOM_101",
  "locationId": "ROOM_101",
  "noiseLevel": 52,
  "unit": "dB",
  "measurementType": "approximate",
  "timestamp": "2026-09-28T10:30:00Z"
}
```

### Browser Demo (Local Network)

For a local demo without a backend, open the browser console and call:

```js
window.__noiseMonitor.ingest({
  deviceId: "ESP32_ROOM_101",
  locationId: "ROOM_101",
  noiseLevel: 65,
  unit: "dB",
  measurementType: "approximate",
  timestamp: new Date().toISOString()
});
```

### Production Setup

For production, create a Firebase Cloud Function:

```js
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.ingestReading = functions.https.onRequest(async (req, res) => {
  const { deviceId, locationId, noiseLevel, timestamp } = req.body;
  await admin.firestore().collection('noise_readings').add({
    deviceId, locationId, noiseLevel,
    timestamp: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
    source: 'hardware',
    measurementType: 'approximate',
  });
  res.json({ success: true });
});
```

Then point your ESP32 to: `https://YOUR_PROJECT.cloudfunctions.net/ingestReading`

### ESP32 Arduino Code

See `src/services/hardwareService.js` for a full Arduino C++ code example.

---

## Hardware Integration Files

| File | Purpose |
|------|---------|
| `src/services/hardwareService.js` | Payload validation, normalization, ESP32 code reference |
| `src/firebase/firestoreService.js` | Firestore read/write operations |
| `src/contexts/AppContext.jsx` | `ingestHardwareReading()` function — core ingestion point |

---

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── NoiseGauge.jsx   # SVG animated gauge
│   ├── NoiseChart.jsx   # Recharts line chart
│   ├── RoomCard.jsx     # Location monitoring card
│   ├── AlertCard.jsx    # Alert item
│   ├── SummaryCard.jsx  # KPI card
│   ├── Header.jsx       # Top navigation
│   ├── Sidebar.jsx      # Side navigation
│   ├── SimulationPanel.jsx # Simulation controls
│   └── CriticalAlertOverlay.jsx # Full-screen critical alert
├── pages/               # Route pages
│   ├── LandingPage.jsx
│   ├── DashboardPage.jsx
│   ├── LiveMonitorPage.jsx
│   ├── RoomsPage.jsx
│   ├── AlertCenterPage.jsx
│   ├── AnalyticsPage.jsx
│   ├── DevicesPage.jsx
│   ├── SettingsPage.jsx
│   └── FullscreenPage.jsx
├── contexts/
│   └── AppContext.jsx   # Global state, alert logic, simulation engine
├── firebase/
│   ├── config.js        # Firebase initialization (graceful fallback)
│   └── firestoreService.js # Firestore CRUD operations
├── services/
│   └── hardwareService.js # ESP32 integration module
└── utils/
    ├── noiseUtils.js    # Status logic, formatting, simulation generators
    └── demoData.js      # Demo locations, devices, alert history
```

---

## Important Disclaimers

- **Approximate readings only.** Noise levels shown are approximate sensor readings, not calibrated dB(A). Accuracy depends on the sensor model, microphone characteristics, and calibration.
- **No audio recorded.** Only numeric noise measurements are stored. No voice or conversation data is captured.
- **Informational alerts only.** This system does not replace hospital staff or medical devices.
- **Hackathon MVP.** This is a proof of concept, not a production medical device.

---

## Deployment (Vercel)

```bash
# Build for production
npm run build

# Deploy with Vercel CLI
vercel --prod
```

Add environment variables in Vercel dashboard under Project → Settings → Environment Variables.

---

## Completed Features ✅

- [x] Dashboard with live gauge and summary cards
- [x] Animated SVG noise gauge (sm/md/lg/xl sizes)
- [x] Live chart with threshold lines
- [x] Multi-location room cards with mini charts
- [x] Simulation mode (Normal/Warning/Critical/Random)
- [x] Sustained-duration alert logic (configurable, default 10s)
- [x] Critical alert full-screen overlay
- [x] Alert center with filters and acknowledge
- [x] Analytics with time filters, location comparison, CSV export
- [x] Device management page with ESP32 guide
- [x] Wearable module placeholder
- [x] Full-screen display mode
- [x] Admin settings with add/edit/delete locations
- [x] Firebase integration (graceful demo-mode fallback)
- [x] Hardware ingestion API documented
- [x] Global browser ingestor (window.__noiseMonitor.ingest)
- [x] Stale data detection
- [x] Privacy: no audio stored

## Pending Hardware Work 🔧

- [ ] Physical ESP32 + microphone sensor wiring
- [ ] ESP32 firmware with WiFi + HTTP POST
- [ ] NTP timestamp synchronization on ESP32
- [ ] Backend API route (Cloud Function or Express)
- [ ] Sensor calibration for accurate dB(A)
- [ ] Wearable vibration device (ESP32-C3 + BLE)
- [ ] Firebase Authentication for admin login
