// Real-Time Factory Digital Twin — retrofit edge firmware (build plan Phase 8, Route B)
//
// A clamp-on CT (SCT-013) + an IR/proximity part sensor on an ESP32, publishing the
// SAME raw MQTT schema the emulator uses. NO PLC, NO machine modification. Machine
// STATE is inferred downstream by services/inference (novelty #1) — this node ships
// only the measured signals.
//
// Publishes to:  factory/{LINE_ID}/{STATION_ID}/raw   ~1 Hz
//   { "ts": <ISO8601 or ""> , "line_id","station_id","current_a","part_present","part_count" }
//
// Wiring (typical):
//   SCT-013 -> burden resistor + 1.65V bias divider -> GPIO34 (ADC1_CH6)
//   IR/proximity sensor digital out -> GPIO27 (active LOW when a part is present)
//
// libs (see platformio.ini): PubSubClient (MQTT), ArduinoJson

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ----------------------- CONFIG (edit these) -----------------------
static const char* WIFI_SSID     = "YOUR_WIFI";
static const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
static const char* MQTT_HOST     = "192.168.1.10";   // the Mosquitto broker host
static const int   MQTT_PORT     = 1883;

static const char* LINE_ID       = "L1";
static const char* STATION_ID    = "S1";

static const int   PIN_CT        = 34;   // ADC1 pin for the CT burden voltage
static const int   PIN_IR        = 27;   // IR/proximity digital input
static const bool  IR_ACTIVE_LOW = true; // most IR modules pull LOW on detect

// SCT-013 calibration: amps per RMS-count. Tune against a known load (see README).
static const float CURRENT_CAL   = 0.0180f;
static const int   RMS_SAMPLES   = 1480;  // ~3 mains cycles at the sample rate
static const uint32_t PUBLISH_MS = 1000;  // publish cadence

// ----------------------- state -----------------------
WiFiClient      net;
PubSubClient    mqtt(net);
char            topic[80];
volatile uint32_t partCount = 0;
int             lastIr = HIGH;
uint32_t        lastPublish = 0;

// ----------------------- helpers -----------------------
float readCurrentRms() {
  // Remove DC bias with a running mean, accumulate squared AC component.
  double sumSq = 0.0;
  double mean  = analogRead(PIN_CT);
  for (int i = 0; i < RMS_SAMPLES; i++) {
    int raw = analogRead(PIN_CT);
    mean += (raw - mean) / 40.0;          // track the mid-rail bias
    double ac = raw - mean;
    sumSq += ac * ac;
  }
  double rms = sqrt(sumSq / RMS_SAMPLES);
  return (float)(rms * CURRENT_CAL);
}

bool readPartPresent() {
  int v = digitalRead(PIN_IR);
  return IR_ACTIVE_LOW ? (v == LOW) : (v == HIGH);
}

void pollIrEdge() {
  int v = digitalRead(PIN_IR);
  int detect = IR_ACTIVE_LOW ? LOW : HIGH;
  if (v == detect && lastIr != detect) partCount++;   // rising edge of "part present"
  lastIr = v;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); }
}

void connectMqtt() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  while (!mqtt.connected()) {
    String cid = String("esp32-") + STATION_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(cid.c_str())) break;
    delay(1000);
  }
}

// ----------------------- arduino -----------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_IR, IR_ACTIVE_LOW ? INPUT_PULLUP : INPUT);
  analogReadResolution(12);
  snprintf(topic, sizeof(topic), "factory/%s/%s/raw", LINE_ID, STATION_ID);
  connectWifi();
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  pollIrEdge();  // catch part edges between publishes

  uint32_t now = millis();
  if (now - lastPublish >= PUBLISH_MS) {
    lastPublish = now;
    float amps = readCurrentRms();
    bool present = readPartPresent();

    JsonDocument doc;
    // no "ts" field: services/inference stamps arrival time (or add NTP here to
    // send a real ISO-8601 timestamp).
    doc["line_id"]      = LINE_ID;
    doc["station_id"]   = STATION_ID;
    doc["current_a"]    = amps;
    doc["part_present"] = present;
    doc["part_count"]   = partCount;

    char buf[192];
    size_t n = serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(topic, buf, n);
    Serial.printf("%s  %.2f A  present=%d count=%u\n", topic, amps, present, partCount);
  }
}
