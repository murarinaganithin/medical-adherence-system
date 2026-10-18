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

// ======================================================
// USER CONFIGURATION (Configure for your network)
// ======================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Replace with your PC/server's local network IP address (e.g., http://192.168.1.150:3000)
// Do NOT use "localhost" or "127.0.0.1" from the ESP32.
const char* SERVER_BASE_URL = "http://192.168.1.100:3000";
const char* DEVICE_ID       = "ESP32_001";

// ======================================================
// PIN DEFINITIONS
// ======================================================
#define SERVO_PIN   19   // Servo signal pin (PWM)
#define LED_PIN     32   // Status LED pin
#define BUTTON_PIN  26   // Push button input pin (Internal Pull-Up enabled)

// ======================================================
// TIMING CONSTANTS
// ======================================================
const unsigned long POLL_INTERVAL_MS = 5000;   // Poll server every 5 seconds
const unsigned long DEBOUNCE_DELAY_MS = 50;    // Button debounce threshold

// ======================================================
// SYSTEM STATES
// ======================================================
enum SystemState {
  STATE_IDLE,                 // Waiting for alarm from server
  STATE_ALARM_WAIT_OPEN,      // LED ON, waiting for Button Press 1
  STATE_WAIT_CLOSE_CONFIRM    // Compartment OPEN (90 deg), waiting for Button Press 2
};

SystemState currentState = STATE_IDLE;
String activeReminderId = "";
String activeMedicine = "";
int activeTablets = 1;

Servo boxServo;
unsigned long lastPollTime = 0;

// Button debouncing variables
int lastButtonState = HIGH;
int buttonState = HIGH;
unsigned long lastDebounceTime = 0;

// ======================================================
// HELPER FUNCTIONS: HARDWARE CONTROL
// ======================================================

void openCompartment() {
  Serial.println("[HARDWARE] Opening compartment -> Servo 90 degrees");
  boxServo.write(90);
}

void closeCompartment() {
  Serial.println("[HARDWARE] Closing compartment -> Servo 0 degrees");
  boxServo.write(0);
}

void turnLedOn() {
  Serial.println("[HARDWARE] Turning LED ON");
  digitalWrite(LED_PIN, HIGH);
}

void turnLedOff() {
  Serial.println("[HARDWARE] Turning LED OFF");
  digitalWrite(LED_PIN, LOW);
}

// ======================================================
// HELPER FUNCTIONS: NETWORK & HTTP
// ======================================================

void connectToWiFi() {
  Serial.print("[WIFI] Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.print("[WIFI] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Connection failed. Will retry in loop.");
  }
}

/**
 * Poll server: GET /api/device/command?deviceId=...
 * Checks if a reminder is currently due for this device.
 */
void pollDeviceCommand() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Disconnected. Reconnecting...");
    connectToWiFi();
    return;
  }

  HTTPClient http;
  String url = String(SERVER_BASE_URL) + "/api/device/command?deviceId=" + String(DEVICE_ID);
  
  http.begin(url);
  http.setTimeout(4000);

  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();

    // If server returned "null", no reminder is due
    if (payload == "null" || payload.length() < 5) {
      // No active command
      http.end();
      return;
    }

    // Parse JSON response
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error) {
      const char* command = doc["command"];
      const char* id = doc["id"] ? doc["id"] : doc["_id"];

      if (id && command && String(command) == "ALARM") {
        activeReminderId = String(id);
        activeMedicine = doc["medicine"] | "Prescribed Medicine";
        activeTablets = doc["tablets"] | 1;

        Serial.println("========================================");
        Serial.println("[ALARM RECEIVED]");
        Serial.print("Reminder ID: "); Serial.println(activeReminderId);
        Serial.print("Medicine:    "); Serial.println(activeMedicine);
        Serial.print("Tablets:     "); Serial.println(activeTablets);
        Serial.println("========================================");

        // Transition to ALARM state: Turn LED ON, wait for Button 1
        turnLedOn();
        currentState = STATE_ALARM_WAIT_OPEN;
      }
    } else {
      Serial.print("[JSON] Parse error: ");
      Serial.println(error.c_str());
    }
  } else {
    Serial.print("[HTTP] GET /api/device/command failed, code: ");
    Serial.println(httpCode);
  }

  http.end();
}

/**
 * Report compartment opened to server: POST /api/schedules/:id/opened
 */
bool reportCompartmentOpened(String scheduleId) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(SERVER_BASE_URL) + "/api/schedules/" + scheduleId + "/opened";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000);

  int httpCode = http.POST("{}");

  bool success = (httpCode == 200 || httpCode == 201);
  if (success) {
    Serial.println("[HTTP] Successfully reported compartment OPENED to server.");
  } else {
    Serial.print("[HTTP] Failed to report compartment opened. Code: ");
    Serial.println(httpCode);
  }

  http.end();
  return success;
}

/**
 * Report medicine completion to server: POST /api/schedules/:id/taken
 * Note: Represents the user's manual confirmation that they took the medicine.
 */
bool reportMedicineTaken(String scheduleId) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(SERVER_BASE_URL) + "/api/schedules/" + scheduleId + "/taken";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000);

  int httpCode = http.POST("{}");

  bool success = (httpCode == 200 || httpCode == 201);
  if (success) {
    Serial.println("[HTTP] Successfully reported medicine TAKEN to server.");
  } else {
    Serial.print("[HTTP] Failed to report medicine taken. Code: ");
    Serial.println(httpCode);
  }

  http.end();
  return success;
}

// ======================================================
// ARDUINO SETUP
// ======================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n--- Starting Smart Medicine Box ESP32 Firmware ---");

  // Configure LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Configure Button with internal pull-up (Active LOW: unpressed=HIGH, pressed=LOW)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Configure Servo
  ESP32PWM::allocateTimer(0);
  boxServo.setPeriodHertz(50);             // Standard 50Hz servo
  boxServo.attach(SERVO_PIN, 500, 2400);   // Standard PWM pulse width
  boxServo.write(0);                       // Start closed at 0 degrees
  delay(500);

  Serial.println("[PINS] Initialized:");
  Serial.println("  - Servo on GPIO 19 (at 0 degrees)");
  Serial.println("  - LED on GPIO 32 (OFF)");
  Serial.println("  - Button on GPIO 26 (INPUT_PULLUP)");

  // Connect Wi-Fi
  connectToWiFi();
}

// ======================================================
// ARDUINO MAIN LOOP
// ======================================================
void loop() {
  unsigned long currentMillis = millis();

  // --------------------------------------------------
  // 1. BUTTON DEBOUNCING & PRESS DETECTION
  // --------------------------------------------------
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonState) {
    lastDebounceTime = currentMillis;
  }

  bool buttonPressedEvent = false;

  if ((currentMillis - lastDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (reading != buttonState) {
      buttonState = reading;
      // Active LOW: Transition from HIGH to LOW means button was pressed
      if (buttonState == LOW) {
        buttonPressedEvent = true;
      }
    }
  }
  lastButtonState = reading;

  // --------------------------------------------------
  // 2. STATE MACHINE EXECUTION
  // --------------------------------------------------
  switch (currentState) {

    // ------------------------------------------------
    // STATE_IDLE: Normal mode, poll server every 5 seconds
    // ------------------------------------------------
    case STATE_IDLE:
      if (currentMillis - lastPollTime >= POLL_INTERVAL_MS) {
        lastPollTime = currentMillis;
        pollDeviceCommand();
      }
      break;

    // ------------------------------------------------
    // STATE_ALARM_WAIT_OPEN:
    // LED is ON. Waiting for 1st button press.
    // ------------------------------------------------
    case STATE_ALARM_WAIT_OPEN:
      if (buttonPressedEvent) {
        Serial.println("\n[EVENT] Button Press 1 detected!");
        
        // 1. Turn LED OFF
        turnLedOff();

        // 2. Open servo to 90 degrees
        openCompartment();

        // 3. Notify server that compartment was opened
        reportCompartmentOpened(activeReminderId);

        // 4. Transition to waiting for 2nd button press
        Serial.println("[STATE] Compartment open. Waiting for Button Press 2 (intake confirmation)...");
        currentState = STATE_WAIT_CLOSE_CONFIRM;
      }
      break;

    // ------------------------------------------------
    // STATE_WAIT_CLOSE_CONFIRM:
    // Compartment is at 90 deg. Waiting for 2nd button press.
    // ------------------------------------------------
    case STATE_WAIT_CLOSE_CONFIRM:
      if (buttonPressedEvent) {
        Serial.println("\n[EVENT] Button Press 2 detected (Medicine Taken Confirmation)!");

        // 1. Return servo to 0 degrees
        closeCompartment();

        // 2. Notify server that medicine was taken
        reportMedicineTaken(activeReminderId);

        // 3. Reset reminder state and return to IDLE
        Serial.println("[STATE] Medicine completed. Returning to IDLE polling.\n");
        activeReminderId = "";
        activeMedicine = "";
        currentState = STATE_IDLE;
        lastPollTime = currentMillis; // Reset timer so it doesn't poll immediately
      }
      break;
  }

  delay(10); // Small loop yield for ESP32 background tasks (Wi-Fi stack)
}
