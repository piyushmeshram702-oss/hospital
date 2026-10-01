import { SerialPort } from 'serialport';
import { setTimeout as delay } from 'timers/promises';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) return null;
    const [, key, value] = match;
    return [key, value ?? true];
  }).filter(Boolean)
);

const portName = args.port || '/dev/cu.usbmodem1101';
const url = args.url || 'http://localhost:3001/reading';
const locationId = args.location || 'ROOM_101';
const deviceId = args.deviceId || 'GROVE_SOUND_01';
const baudRate = Number(args.baud || 9600);
const pollMs = Number(args.pollMs || 2000);

async function postReading(level, frequencyHz) {
  const payload = {
    deviceId,
    locationId,
    noiseLevel: Number(level),
    frequencyHz: Number.isFinite(frequencyHz) ? Number(frequencyHz) : null,
    deviceName: 'Grove Sound Sensor',
    status: Number(level) >= 70 ? 'WARNING' : 'NORMAL',
    source: 'grove',
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error('[bridge] POST failed', response.status, text);
      return;
    }

    console.log('[bridge] sent', payload.noiseLevel, 'sensor level ->', text);
  } catch (error) {
    console.error('[bridge] Relay unavailable:', error.message);
  }
}

const port = new SerialPort({
  path: portName,
  baudRate,
  autoOpen: false,
});

let buffer = '';

port.on('error', (err) => {
  console.error('[bridge] Serial error:', err.message);
});

port.on('data', async (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let reading;
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      reading = { noiseLevel: Number(trimmed) };
    } else {
      try {
        reading = JSON.parse(trimmed);
      } catch {
        reading = null;
      }
    }

    if (!reading || typeof reading.noiseLevel !== 'number') {
      console.warn('[bridge] Ignoring serial line:', trimmed);
      continue;
    }

    const level = Number(reading.noiseLevel);
    if (level < 0 || level > 100) {
      console.warn('[bridge] Ignoring out-of-range sensor level:', level);
      continue;
    }

    const frequencyHz = Number(reading.frequencyHz);
    await postReading(level, Number.isFinite(frequencyHz) && frequencyHz >= 0 && frequencyHz <= 5000 ? frequencyHz : null);
  }
});

async function start() {
  console.log(`[bridge] Opening ${portName} @ ${baudRate}...`);
  port.open((err) => {
    if (err) {
      console.error('[bridge] Could not open serial port:', err.message);
      process.exit(1);
    }
    console.log('[bridge] Connected. Waiting for Grove readings...');
  });

  while (true) {
    await delay(pollMs);
  }
}

start().catch((err) => {
  console.error('[bridge] fatal:', err);
  process.exit(1);
});
