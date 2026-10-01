const uint8_t SOUND_SENSOR_PIN = A0;
const unsigned long SAMPLE_WINDOW_US = 50000;
const int QUIET_PEAK_TO_PEAK = 8;
const int LOUD_PEAK_TO_PEAK = 400;

struct SoundReading {
  int noiseLevel;
  unsigned long frequencyHz;
};

SoundReading readSoundReading() {
  int signalMin = 1023;
  int signalMax = 0;
  unsigned long windowStart = micros();

  while (micros() - windowStart < SAMPLE_WINDOW_US) {
    int sample = analogRead(SOUND_SENSOR_PIN);
    if (sample < signalMin) signalMin = sample;
    if (sample > signalMax) signalMax = sample;
  }

  int peakToPeak = signalMax - signalMin;
  int level = map(peakToPeak, QUIET_PEAK_TO_PEAK, LOUD_PEAK_TO_PEAK, 0, 100);
  int midpoint = (signalMin + signalMax) / 2;
  int previousSample = analogRead(SOUND_SENSOR_PIN);
  unsigned int crossingCount = 0;
  unsigned long firstCrossing = 0;
  unsigned long lastCrossing = 0;
  windowStart = micros();

  while (micros() - windowStart < SAMPLE_WINDOW_US) {
    int sample = analogRead(SOUND_SENSOR_PIN);
    if (previousSample <= midpoint && sample > midpoint) {
      unsigned long crossingTime = micros();
      if (crossingCount == 0) firstCrossing = crossingTime;
      lastCrossing = crossingTime;
      crossingCount++;
    }
    previousSample = sample;
  }

  unsigned long frequency = 0;
  if (peakToPeak >= QUIET_PEAK_TO_PEAK * 2 && crossingCount > 1 && lastCrossing > firstCrossing) {
    frequency = (unsigned long)(crossingCount - 1) * 1000000UL / (lastCrossing - firstCrossing);
  }

  SoundReading reading = { constrain(level, 0, 100), min(frequency, 5000UL) };
  return reading;
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  SoundReading reading = readSoundReading();
  Serial.print("{\"noiseLevel\":");
  Serial.print(reading.noiseLevel);
  Serial.print(",\"frequencyHz\":");
  Serial.print(reading.frequencyHz);
  Serial.println("}");
  delay(200);
}
