
/*
 * Smart Medicine Box
 * ESP32 + Wi-Fi + Node.js Backend + 3 Compartments
 * DS3231 RTC + I2C LCD
 *
 * LEDs:    32, 33, 25
 * Buttons: 26, 27, 14
 * Servos:  13, 18, 19
 * I2C SDA:  21
 * I2C SCL:  22
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <RTClib.h>
#include <LiquidCrystal_I2C.h>

// ---------- Wi-Fi and Backend ----------
const char* WIFI_NAME = "SSID";
const char* WIFI_PASSWORD = "Password";

const char* API_BASE = "http://192.168.29.3:3000";
const char* USER_ID = "USER.ID";
const char* DEVICE_ID = "ESP32_001";

// ---------- Hardware Pins ----------
const int ledPins[3] = {32, 33, 25};
const int buttonPins[3] = {26, 27, 14};
const int servoPins[3] = {13, 18, 19};

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

int lastButtonReading[3] = {HIGH, HIGH, HIGH};
int stableButtonState[3] = {HIGH, HIGH, HIGH};

unsigned long lastDebounceTime[3] = {0, 0, 0};

const unsigned long DEBOUNCE_MS = 40;
const unsigned long POLL_INTERVAL_MS = 2000;
const unsigned long BLINK_INTERVAL_MS = 500;

unsigned long lastPollTime = 0;
unsigned long lastBlinkTime = 0;

bool backlightOn = true;

// ---------- RTC Date ----------
String dateString(DateTime now) {
  char buffer[11];

  snprintf(
    buffer, sizeof(buffer), "%04d-%02d-%02d",
    now.year(), now.month(), now.day()
  );

  return String(buffer);
}

// ---------- Send Event to Backend ----------
bool postEvent(int slot, const char* eventName) {
  if (alarmIds[slot].length() == 0) {
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

    alarmIds[index] = String(
      alarm["id"] | ""
    );

    medicineNames[index] = String(
      alarm["medicine"] | "Medicine"
    );

    String status = alarm["status"] | "";

    if (status == "due") {
      alarmActive[index] = true;

      digitalWrite(ledPins[index], HIGH);

      Serial.printf(
        "Compartment %d due: %s\n",
        index + 1,
        medicineNames[index].c_str()
      );
    }
    else if (status == "opened") {
      alarmActive[index] = false;
      slotOpened[index] = true;

      digitalWrite(ledPins[index], LOW);
      servos[index].write(90);
    }
  }

  // Reset slots not returned by the backend.
  for (int i = 0; i < 3; i++) {
    if (!seen[i]) {
      digitalWrite(ledPins[i], LOW);

      alarmActive[i] = false;
      slotOpened[i] = false;
      alarmIds[i] = "";

      servos[i].write(0);
    }
  }
}

// ---------- Button Handling ----------
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
      // Keep reminder active if server update fails.
      servos[slot].write(0);
      digitalWrite(ledPins[slot], HIGH);
      alarmActive[slot] = true;
    }
  }
  else {
    // Second press: confirm medicine taken.
    servos[slot].write(0);

    if (postEvent(slot, "taken")) {
      slotOpened[slot] = false;
      alarmActive[slot] = false;

      alarmIds[slot] = "";
      digitalWrite(ledPins[slot], LOW);

      Serial.printf(
        "Compartment %d marked taken\n",
        slot + 1
      );
    }
    else {
      // Restore opened state if server update fails.
      servos[slot].write(90);
    }
  }
}

// ---------- LCD Display ----------
void updateLCD(DateTime now) {
  int activeSlot = -1;

  // Display the first due medicine.
  for (int i = 0; i < 3; i++) {
    if (alarmActive[i]) {
      activeSlot = i;
      break;
    }
  }

  if (activeSlot >= 0) {
    // Blink LCD backlight every 500 milliseconds.
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
    // Normal mode: display RTC time and date.
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

  // Shared I2C bus for RTC and LCD.
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

  // Uncomment ONLY for the first upload to set RTC time.
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

  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi connected");

  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  lcd.clear();
  lcd.print("WiFi Connected");
  delay(1000);
  lcd.clear();
  // rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  pollAlarms();
}

// ---------- Main Loop ----------
void loop() {
  DateTime now = rtc.now();

  // Read all three independent buttons.
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

  // Poll backend every two seconds.
  if (millis() - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = millis();
    pollAlarms();
  }

  // Update LCD using RTC time.
  updateLCD(now);

  // Print RTC time to Serial Monitor.
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
