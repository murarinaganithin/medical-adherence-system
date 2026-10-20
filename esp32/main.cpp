/*
 * SMART MEDICINE BOX
 * ESP32 + WiFi + Node.js + MongoDB
 * 3 Compartments + RTC + LCD + 10-minute Snooze
 *
 * LEDs:    32, 33, 25
 * Buttons: 26, 27, 14
 * Servos:  13, 18, 19
 * Snooze:   4
 * Speaker: 23 (transistor-controlled KEY1)
 * SDA:     21
 * SCL:     22
 *
 * DFPlayer RX/TX are disconnected.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <RTClib.h>
#include <LiquidCrystal_I2C.h>

// ---------- WiFi and Backend ----------
const char* WIFI_NAME = "Sameer.2";
const char* WIFI_PASSWORD = "password";

const char* API_BASE = "http://192.168.29.3:3000";
const char* USER_ID = "6ad4ab397eec8c0d40e091b4";
const char* DEVICE_ID = "ESP32_001";

// ---------- Hardware Pins ----------
const int ledPins[3] = {32, 33, 25};
const int buttonPins[3] = {26, 27, 14};
const int servoPins[3] = {13, 18, 19};

const int snoozeButtonPin = 4;
const int speakerKeyPin = 23;

// ---------- Speaker Timing ----------
const unsigned long SPEAKER_PULSE_MS = 300;
const unsigned long SPEAKER_REPEAT_MS = 5000;

unsigned long lastSpeakerTrigger[3] = {0, 0, 0};
bool speakerTriggeredBefore[3] = {false, false, false};

bool speakerPulseActive = false;
unsigned long speakerPulseStartedAt = 0;
int speakerPulseSlot = -1;

// ---------- RTC and LCD ----------
RTC_DS3231 rtc;
LiquidCrystal_I2C lcd(0x27, 16, 2);

Servo servos[3];

String alarmIds[3];
String medicineNames[3] = {
  "Medicine 1", "Medicine 2", "Medicine 3"
};

bool slotOpened[3] = {false, false, false};
bool alarmActive[3] = {false, false, false};

// ---------- Compartment Buttons ----------
int lastButtonReading[3] = {HIGH, HIGH, HIGH};
int stableButtonState[3] = {HIGH, HIGH, HIGH};
unsigned long lastDebounceTime[3] = {0, 0, 0};

// ---------- Snooze Button ----------
int lastSnoozeReading = HIGH;
int stableSnoozeState = HIGH;
unsigned long lastSnoozeDebounceTime = 0;

// ---------- Timing ----------
const unsigned long DEBOUNCE_MS = 40;
const unsigned long POLL_INTERVAL_MS = 2000;
const unsigned long BLINK_INTERVAL_MS = 500;

unsigned long lastPollTime = 0;
unsigned long lastBlinkTime = 0;
bool backlightOn = true;

// ---------- Send Event to Backend ----------
bool postEvent(int slot, const char* eventName) {
  if (alarmIds[slot].length() == 0) {
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot send event: WiFi disconnected");
    return false;
  }

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

// ---------- Stop KEY1 Trigger for One Slot ----------
void stopSpeakerTriggerForSlot(int slot) {
  if (speakerPulseActive && speakerPulseSlot == slot) {
    digitalWrite(speakerKeyPin, LOW);
    speakerPulseActive = false;
    speakerPulseSlot = -1;
  }
}

// ---------- Speaker Trigger Every 5 Seconds ----------
void updateSpeakerTrigger() {
  unsigned long now = millis();

  // End the current 300 ms trigger pulse.
  if (speakerPulseActive &&
      now - speakerPulseStartedAt >= SPEAKER_PULSE_MS) {

    digitalWrite(speakerKeyPin, LOW);

    speakerPulseActive = false;
    speakerPulseSlot = -1;
  }

  // Only one KEY1 trigger at a time.
  if (speakerPulseActive) {
    return;
  }

  // Trigger active, unopened compartments.
  for (int i = 0; i < 3; i++) {
    if (alarmActive[i] &&
        !slotOpened[i] &&
        (!speakerTriggeredBefore[i] ||
         now - lastSpeakerTrigger[i] >= SPEAKER_REPEAT_MS)) {

      // HIGH turns the external transistor ON.
      // The transistor momentarily connects KEY1 to GND.
      digitalWrite(speakerKeyPin, HIGH);

      speakerPulseActive = true;
      speakerPulseStartedAt = now;
      speakerPulseSlot = i;

      lastSpeakerTrigger[i] = now;
      speakerTriggeredBefore[i] = true;

      Serial.printf(
        "Speaker KEY1 trigger: compartment %d\n",
        i + 1
      );

      break;
    }
  }
}

// ---------- Snooze One Compartment ----------
bool postSnooze(int slot) {
  if (alarmIds[slot].length() == 0) {
    Serial.printf(
      "No alarm ID for compartment %d\n",
      slot + 1
    );
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot snooze: WiFi disconnected");
    return false;
  }

  HTTPClient http;

  String url = String(API_BASE) + "/api/schedules/" +
               alarmIds[slot] + "/snooze";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST("{\"minutes\":10}");
  String response = http.getString();

  Serial.printf(
    "Compartment %d snooze, HTTP %d\n",
    slot + 1, code
  );

  if (code < 200 || code >= 300) {
    Serial.println(response);
    http.end();
    return false;
  }

  http.end();

  stopSpeakerTriggerForSlot(slot);

  alarmActive[slot] = false;
  digitalWrite(ledPins[slot], LOW);

  Serial.printf(
    "Compartment %d snoozed for 10 minutes\n",
    slot + 1
  );

  return true;
}

// ---------- Snooze Button ----------
void handleSnoozeButton() {
  bool foundAlarm = false;
  bool snoozedAlarm = false;

  for (int i = 0; i < 3; i++) {
    if (alarmActive[i] &&
        !slotOpened[i] &&
        alarmIds[i].length() > 0) {

      foundAlarm = true;

      if (postSnooze(i)) {
        snoozedAlarm = true;
      }
    }
  }

  if (!foundAlarm) {
    Serial.println("No due medicine to snooze");
  }

  if (snoozedAlarm) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Snoozed 10 min");
    lcd.setCursor(0, 1);
    lcd.print("Reminder paused");
  }
}

// ---------- Fetch Alarms from Backend ----------
void pollAlarms() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;

  String url = String(API_BASE) +
    "/api/device/commands?deviceId=" + DEVICE_ID +
    "&userId=" + USER_ID;

  http.begin(url);

  int code = http.GET();

  if (code != 200) {
    Serial.printf("Alarm fetch failed: HTTP %d\n", code);
    Serial.println("Requested URL: " + url);
    Serial.println("Server response: " + http.getString());

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

    if (index < 0 || index > 2) {
      continue;
    }

    seen[index] = true;

    alarmIds[index] = String(alarm["id"] | "");
    medicineNames[index] = String(
      alarm["medicine"] | "Medicine"
    );

    String status = alarm["status"] | "";

    if (status == "due") {
      alarmActive[index] = true;
      slotOpened[index] = false;

      digitalWrite(ledPins[index], HIGH);

      Serial.printf(
        "Compartment %d due: %s\n",
        index + 1,
        medicineNames[index].c_str()
      );
    }
    else if (status == "opened") {
      stopSpeakerTriggerForSlot(index);

      alarmActive[index] = false;
      slotOpened[index] = true;

      digitalWrite(ledPins[index], LOW);
      servos[index].write(90);

      Serial.printf(
        "Compartment %d opened on backend\n",
        index + 1
      );
    }
    else if (status == "snoozed") {
      stopSpeakerTriggerForSlot(index);

      alarmActive[index] = false;
      slotOpened[index] = false;

      digitalWrite(ledPins[index], LOW);

      Serial.printf(
        "Compartment %d snoozed by backend\n",
        index + 1
      );
    }
  }

  // Reset slots not returned by the backend.
  for (int i = 0; i < 3; i++) {
    if (!seen[i]) {
      stopSpeakerTriggerForSlot(i);

      digitalWrite(ledPins[i], LOW);

      alarmActive[i] = false;
      slotOpened[i] = false;
      alarmIds[i] = "";

      speakerTriggeredBefore[i] = false;
      lastSpeakerTrigger[i] = 0;

      servos[i].write(0);
    }
  }
}

// ---------- Compartment Button ----------
void handleButton(int slot) {
  if (alarmIds[slot].length() == 0) {
    Serial.printf(
      "No active alarm for compartment %d\n",
      slot + 1
    );
    return;
  }

  if (!slotOpened[slot]) {
    // First press: open compartment.
    stopSpeakerTriggerForSlot(slot);

    servos[slot].write(90);
    digitalWrite(ledPins[slot], LOW);

    if (postEvent(slot, "opened")) {
      slotOpened[slot] = true;
      alarmActive[slot] = false;

      Serial.printf(
        "Compartment %d opened\n",
        slot + 1
      );
    }
    else {
      servos[slot].write(0);
      digitalWrite(ledPins[slot], HIGH);
      alarmActive[slot] = true;
    }
  }
  else {
    // Second press: confirm medicine taken.
    stopSpeakerTriggerForSlot(slot);

    servos[slot].write(0);

    if (postEvent(slot, "taken")) {
      slotOpened[slot] = false;
      alarmActive[slot] = false;

      alarmIds[slot] = "";

      digitalWrite(ledPins[slot], LOW);

      speakerTriggeredBefore[slot] = false;
      lastSpeakerTrigger[slot] = 0;

      Serial.printf(
        "Compartment %d marked taken\n",
        slot + 1
      );
    }
    else {
      servos[slot].write(90);
    }
  }
}

// ---------- LCD Display ----------
void updateLCD(DateTime now) {
  int activeSlot = -1;

  for (int i = 0; i < 3; i++) {
    if (alarmActive[i]) {
      activeSlot = i;
      break;
    }
  }

  if (activeSlot >= 0) {
    if (millis() - lastBlinkTime >= BLINK_INTERVAL_MS) {
      lastBlinkTime = millis();
      backlightOn = !backlightOn;

      if (backlightOn) {
        lcd.backlight();
      }
      else {
        lcd.noBacklight();
      }
    }

    lcd.setCursor(0, 0);
    lcd.print("TAKE MEDICINE   ");

    lcd.setCursor(0, 1);
    lcd.print("                ");

    lcd.setCursor(0, 1);
    lcd.print(medicineNames[activeSlot].substring(0, 16));
  }
  else {
    backlightOn = true;
    lcd.backlight();

    lcd.setCursor(0, 0);

    char timeBuffer[17];

    snprintf(
      timeBuffer, sizeof(timeBuffer),
      "Time: %02d:%02d:%02d",
      now.hour(), now.minute(), now.second()
    );

    lcd.print(timeBuffer);

    lcd.setCursor(0, 1);

    char dateBuffer[17];

    snprintf(
      dateBuffer, sizeof(dateBuffer),
      "%04d-%02d-%02d",
      now.year(), now.month(), now.day()
    );

    lcd.print(dateBuffer);
    lcd.print("   ");
  }
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);

  lcd.init();
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("Medicine Box");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");

  if (!rtc.begin()) {
    lcd.clear();
    lcd.print("RTC not found!");

    Serial.println("DS3231 RTC not found!");

    while (true) {
      delay(100);
    }
  }

  // Uncomment for one upload if you need to set RTC time.
  // rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  // Comment it again after setting the time.

  if (rtc.lostPower()) {
    Serial.println(
      "RTC lost power. Set the RTC time before use."
    );
  }

  for (int i = 0; i < 3; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);

    pinMode(buttonPins[i], INPUT_PULLUP);

    servos[i].setPeriodHertz(50);
    servos[i].attach(servoPins[i], 500, 2400);
    servos[i].write(0);
  }

  // Snooze button connects GPIO 4 to GND.
  pinMode(snoozeButtonPin, INPUT_PULLUP);

  // GPIO 23 controls an external transistor for KEY1.
  pinMode(speakerKeyPin, OUTPUT);
  digitalWrite(speakerKeyPin, LOW);

  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected");

  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  lcd.clear();
  lcd.print("WiFi Connected");
  delay(1000);
  lcd.clear();

  pollAlarms();
}

// ---------- Main Loop ----------
void loop() {
  DateTime now = rtc.now();

  // Read the three compartment buttons.
  for (int i = 0; i < 3; i++) {
    int reading = digitalRead(buttonPins[i]);

    if (reading != lastButtonReading[i]) {
      lastDebounceTime[i] = millis();
    }

    if (millis() - lastDebounceTime[i] >= DEBOUNCE_MS) {
      if (reading != stableButtonState[i]) {
        stableButtonState[i] = reading;

        if (stableButtonState[i] == LOW) {
          handleButton(i);
        }
      }
    }

    lastButtonReading[i] = reading;
  }

  // Read the snooze button.
  int snoozeReading = digitalRead(snoozeButtonPin);

  if (snoozeReading != lastSnoozeReading) {
    lastSnoozeDebounceTime = millis();
  }

  if (millis() - lastSnoozeDebounceTime >= DEBOUNCE_MS) {
    if (snoozeReading != stableSnoozeState) {
      stableSnoozeState = snoozeReading;

      if (stableSnoozeState == LOW) {
        handleSnoozeButton();
      }
    }
  }

  lastSnoozeReading = snoozeReading;

  // Fetch backend alarm status every 2 seconds.
  if (millis() - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = millis();
    pollAlarms();
  }

  // Trigger DFPlayer KEY1 every 5 seconds while due.
  updateSpeakerTrigger();

  updateLCD(now);

  // Print RTC time every second.
  static unsigned long lastSerialTime = 0;

  if (millis() - lastSerialTime >= 1000) {
    lastSerialTime = millis();

    Serial.printf(
      "RTC: %04d-%02d-%02d %02d:%02d:%02d\n",
      now.year(), now.month(), now.day(),
      now.hour(), now.minute(), now.second()
    );
  }

  delay(10);
}