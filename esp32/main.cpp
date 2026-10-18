/**
 * Smart Medicine Box - ESP32 Firmware
 * Hardware Components:
 *  - 1 x ESP32 Dev Module
 *  - 1 x Servo Motor on GPIO 19
 *  - 1 x Status LED on GPIO 32
 *  - 1 x Push Button on GPIO 26
 *
 * Workflow:
 *  1. Connects to Wi-Fi.
 *  2. Polls Node.js/Express server: GET /api/device/command
 *  3. When a reminder is due, the server returns the reminder ID and medicine details.
 *  4. LED turns ON (GPIO 32 HIGH) to alert user.
 *  5. On Button Press 1:
 *     - LED turns OFF.
 *     - Servo motor moves to 90 degrees (compartment opens).
 *     - ESP32 calls POST /api/schedules/<id>/opened.
 *     - Server records opening timestamp and status.
 *  6. User takes medicine.
 *  7. On Button Press 2:
 *     - Servo motor returns to 0 degrees (compartment closes).
 *     - ESP32 calls POST /api/schedules/<id>/taken.
 *     - Server records completion timestamp and marks status as 'taken'.
 *     (Note: Button 2 represents user's manual confirmation of intake).
 *  8. Returns to idle polling.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---------- CHANGE THESE VALUES ----------
const char* WIFI_NAME = "SSID";
const char* WIFI_PASSWORD = "PASSWORD";

// Use your computer's LAN IPv4 address, NOT localhost.
const char* API_BASE = "http://192.168.29.3:3000";

// Copy this from your logged-in website's localStorage user.id.
const char* USER_ID = "USERID";

const char* DEVICE_ID = "ESP32_001";
// -----------------------------------------

const int ledPins[3] = {32, 33, 25};
const int buttonPins[3] = {26, 27, 14};
const int servoPins[3] = {13, 18, 19};

Servo servos[3];

String alarmIds[3];
bool slotOpened[3] = {false, false, false};

int lastButtonReading[3] = {HIGH, HIGH, HIGH};
int stableButtonState[3] = {HIGH, HIGH, HIGH};
unsigned long lastDebounceTime[3] = {0, 0, 0};

const unsigned long DEBOUNCE_MS = 40;
const unsigned long POLL_INTERVAL_MS = 2000;
unsigned long lastPollTime = 0;

// Send an event to the existing backend route.
bool postEvent(int slot, const char* eventName) {
  if (alarmIds[slot].length() == 0) return false;

  HTTPClient http;
  String url = String(API_BASE) + "/api/schedules/" +
               alarmIds[slot] + "/" + eventName;

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST("{}");
  String response = http.getString();

  Serial.printf(
    "Slot %d, event %s, HTTP %d\n",
    slot + 1, eventName, code
  );

  if (code < 200 || code >= 300) {
    Serial.println(response);
  }

  http.end();
  return code >= 200 && code < 300;
}

// Fetch all currently due/opened alarms.
void pollAlarms() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;

  String url = String(API_BASE) +
    "/api/device/commands?deviceId=" + DEVICE_ID +
    "&userId=" + USER_ID;

  http.begin(url);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("Alarm fetch failed: HTTP %d\n", code);
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    Serial.print("JSON error: ");
    Serial.println(error.c_str());
    return;
  }

  bool seen[3] = {false, false, false};
  JsonArray commands = doc.as<JsonArray>();

  for (JsonObject alarm : commands) {
    int index = alarm["index"] | -1;

    if (index < 0 || index > 2) continue;

    seen[index] = true;

    String id = alarm["id"] | "";
    String status = alarm["status"] | "";

    alarmIds[index] = id;

    if (status == "due") {
      slotOpened[index] = false;
      digitalWrite(ledPins[index], HIGH);

      Serial.printf(
        "Compartment %d is due: %s\n",
        index + 1,
        alarm["medicine"] | "Medicine"
      );
    } else if (status == "opened") {
      slotOpened[index] = true;
      digitalWrite(ledPins[index], LOW);
      servos[index].write(90);
    }
  }

  // Slots not returned by the server are inactive.
  for (int i = 0; i < 3; i++) {
    if (!seen[i]) {
      digitalWrite(ledPins[i], LOW);
      servos[i].write(0);
      slotOpened[i] = false;
      alarmIds[i] = "";
    }
  }
}

// Each button controls only its matching compartment.
void handleButton(int slot) {
  if (alarmIds[slot].length() == 0) {
    Serial.printf("No active alarm for compartment %d\n", slot + 1);
    return;
  }

  if (!slotOpened[slot]) {
    // First press: open compartment.
    digitalWrite(ledPins[slot], LOW);
    servos[slot].write(90);

    if (postEvent(slot, "opened")) {
      slotOpened[slot] = true;
      Serial.printf("Compartment %d opened\n", slot + 1);
    } else {
      // Keep the dose pending if the server update fails.
      servos[slot].write(0);
      digitalWrite(ledPins[slot], HIGH);
    }
  } else {
    // Second press: confirm dose taken.
    servos[slot].write(0);

    if (postEvent(slot, "taken")) {
      slotOpened[slot] = false;
      alarmIds[slot] = "";
      digitalWrite(ledPins[slot], LOW);

      Serial.printf("Compartment %d marked taken\n", slot + 1);
    } else {
      // Restore the opened state if confirmation fails.
      servos[slot].write(90);
    }
  }
}

void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 3; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);

    pinMode(buttonPins[i], INPUT_PULLUP);

    servos[i].setPeriodHertz(50);
    servos[i].attach(servoPins[i], 500, 2400);
    servos[i].write(0);
  }

  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi connected");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  pollAlarms();
}

void loop() {
  for (int i = 0; i < 3; i++) {
    int reading = digitalRead(buttonPins[i]);

    if (reading != lastButtonReading[i]) {
      lastDebounceTime[i] = millis();
    }

    if (millis() - lastDebounceTime[i] >= DEBOUNCE_MS) {
      if (reading != stableButtonState[i]) {
        stableButtonState[i] = reading;

        // INPUT_PULLUP means LOW is pressed.
        if (stableButtonState[i] == LOW) {
          handleButton(i);
        }
      }
    }

    lastButtonReading[i] = reading;
  }

  if (millis() - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = millis();
    pollAlarms();
  }
}
