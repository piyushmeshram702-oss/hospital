// ─────────────────────────────────────────────────────────────────────────────
// Hardware Integration Service
// ─────────────────────────────────────────────────────────────────────────────
//
// HOW TO USE (ESP32 → Web App):
//
// The ESP32 device should make an HTTP POST request to a backend endpoint or
// directly call the ingestHardwareReading() function from AppContext.
//
// For a direct browser integration (local network demo), use:
//   window.__noiseMonitor.ingest(payload)
//
// For a production setup, create a Firebase Cloud Function or small Express
// backend that receives the ESP32 POST and forwards to Firestore.
//
// SECURITY NOTE: Do not expose Firebase admin credentials in the ESP32 firmware.
// Use a Firebase Cloud Function or a simple backend middleware to authenticate
// and forward the readings.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate an incoming hardware payload
 * @param {object} payload
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateHardwarePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be a JSON object' };
  }

  if (!payload.deviceId || typeof payload.deviceId !== 'string') {
    return { valid: false, error: 'Missing or invalid deviceId' };
  }

  if (!payload.locationId || typeof payload.locationId !== 'string') {
    return { valid: false, error: 'Missing or invalid locationId' };
  }

  if (typeof payload.noiseLevel !== 'number' || isNaN(payload.noiseLevel)) {
    return { valid: false, error: 'noiseLevel must be a number' };
  }

  if (payload.noiseLevel < 0 || payload.noiseLevel > 200) {
    return { valid: false, error: 'noiseLevel must be between 0 and 200' };
  }

  return { valid: true };
}

/**
 * Parse a hardware payload into a normalized reading object
 * @param {object} raw - Raw payload from hardware
 * @returns {object} Normalized reading
 */
export function parseHardwarePayload(raw) {
  return {
    deviceId:        raw.deviceId,
    locationId:      raw.locationId,
    noiseLevel:      Math.round(raw.noiseLevel),
    unit:            raw.unit || 'dB',
    measurementType: raw.measurementType || 'approximate',
    timestamp:       raw.timestamp ? new Date(raw.timestamp) : new Date(),
    source:          'hardware',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ESP32 Arduino/MicroPython Code Reference
// ─────────────────────────────────────────────────────────────────────────────
//
// Arduino (C++) example for ESP32 + KY-038 microphone sensor:
//
// #include <WiFi.h>
// #include <HTTPClient.h>
// #include <ArduinoJson.h>
//
// const char* ssid      = "YOUR_WIFI_SSID";
// const char* password  = "YOUR_WIFI_PASSWORD";
// const char* serverUrl = "http://YOUR_BACKEND_URL/api/readings";
// const int   micPin    = 34;  // Analog microphone pin
// const char* deviceId  = "ESP32_ROOM_101";
// const char* locationId = "ROOM_101";
//
// void setup() {
//   Serial.begin(115200);
//   WiFi.begin(ssid, password);
//   while (WiFi.status() != WL_CONNECTED) { delay(500); }
//   Serial.println("WiFi connected");
// }
//
// float readNoiseSamples() {
//   int samples = 100;
//   long sum = 0;
//   for (int i = 0; i < samples; i++) {
//     int val = analogRead(micPin);
//     sum += val;
//     delayMicroseconds(100);
//   }
//   float avg = sum / samples;
//   // Map ADC value to approximate dB range (UNCALIBRATED)
//   // This is sensor-specific. Calibration required for accurate dB(A).
//   return map(avg, 0, 4095, 30, 90);
// }
//
// void loop() {
//   float noise = readNoiseSamples();
//
//   HTTPClient http;
//   http.begin(serverUrl);
//   http.addHeader("Content-Type", "application/json");
//
//   StaticJsonDocument<200> doc;
//   doc["deviceId"]        = deviceId;
//   doc["locationId"]      = locationId;
//   doc["noiseLevel"]      = noise;
//   doc["unit"]            = "dB";
//   doc["measurementType"] = "approximate";
//   doc["timestamp"]       = ""; // ESP32 can use NTP for real timestamp
//
//   String body;
//   serializeJson(doc, body);
//
//   int code = http.POST(body);
//   Serial.printf("Response: %d\n", code);
//   http.end();
//
//   delay(2000); // Send every 2 seconds
// }
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expose a global function for direct browser-based ingestion (local network demo)
 * Call this from App.jsx after mounting
 */
export function registerGlobalIngestor(ingestFn) {
  if (typeof window !== 'undefined') {
    window.__noiseMonitor = {
      ingest: (payload) => {
        const { valid, error } = validateHardwarePayload(payload);
        if (!valid) { console.error('[HardwareService] Invalid payload:', error); return { success: false, error }; }
        const parsed = parseHardwarePayload(payload);
        return ingestFn(parsed);
      },
      version: '1.0.0',
    };
    console.info('[HardwareService] Global ingestor registered at window.__noiseMonitor.ingest()');
  }
}
