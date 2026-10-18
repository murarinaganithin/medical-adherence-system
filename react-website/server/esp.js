const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Models
const TakenDose = require("./models/TakenDose");
const MissedDose = require("./models/MissedDose");
const Alarm = require("./models/Alarm");

const router = express.Router();

// Configuration
const MISSED_THRESHOLD_MINUTES = 15; // 15-minute grace period after scheduled time
const DOUBLE_CLICK_WINDOW_MS = 500;  // 500ms window for double-click detection

// State tracker for raw button clicks (if ESP32 streams single clicks)
const buttonState = {
  lastClickTime: 0,
  clickCount: 0,
  timer: null,
};

// ==========================================
// Helper Functions
// ==========================================

/**
 * Returns date string in YYYY-MM-DD format
 */
function getTodayDateString(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns time string in HH:mm 24-hour format
 */
function getCurrentTimeString(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Converts HH:mm string to minutes from midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Find the most relevant scheduled alarm for taking medicine
 */
async function findActiveAlarm({ userId, alarmIndex } = {}) {
  const query = { enabled: true };
  if (userId) query.userId = userId;
  if (alarmIndex !== undefined && alarmIndex !== null) {
    query.index = Number(alarmIndex);
    const directAlarm = await Alarm.findOne(query);
    if (directAlarm) return directAlarm;
  }

  // Find all enabled alarms
  const alarms = await Alarm.find(query).sort({ time: 1 });
  if (!alarms || alarms.length === 0) {
    return null;
  }

  const nowMinutes = timeToMinutes(getCurrentTimeString());

  // Find alarm with minimum time difference to current time
  let closestAlarm = alarms[0];
  let minDiff = Math.abs(timeToMinutes(alarms[0].time) - nowMinutes);

  for (const alarm of alarms) {
    const diff = Math.abs(timeToMinutes(alarm.time) - nowMinutes);
    if (diff < minDiff) {
      minDiff = diff;
      closestAlarm = alarm;
    }
  }

  return closestAlarm;
}

// ==========================================
// Core Business Logic
// ==========================================

/**
 * Record a Taken Dose in MongoDB (medic database -> takendoses collection)
 * Triggered when ESP32 button is clicked 2 times
 */
async function recordTakenDose({ userId, alarmIndex, medicine, dosage, scheduledTime } = {}) {
  const today = getTodayDateString();
  const now = getCurrentTimeString();

  // 1. Resolve alarm info
  let targetMedicine = medicine;
  let targetDosage = dosage;
  let targetScheduledTime = scheduledTime;

  if (!targetMedicine || !targetScheduledTime) {
    const alarm = await findActiveAlarm({ userId, alarmIndex });
    if (alarm) {
      targetMedicine = targetMedicine || alarm.medicine || "Prescribed Medicine";
      targetDosage = targetDosage || `${alarm.tablets || 1} tablet${(alarm.tablets || 1) > 1 ? "s" : ""}`;
      targetScheduledTime = targetScheduledTime || alarm.time;
    } else {
      // Fallback if no alarms configured yet in DB
      targetMedicine = targetMedicine || "Daily Medication";
      targetDosage = targetDosage || "1 tablet";
      targetScheduledTime = targetScheduledTime || now;
    }
  }

  if (!targetDosage) {
    targetDosage = "1 tablet";
  }

  // 2. Check if this dose was already recorded as taken today
  const existingTaken = await TakenDose.findOne({
    medicine: targetMedicine,
    scheduledDate: today,
    scheduledTime: targetScheduledTime,
  });

  if (existingTaken) {
    return {
      status: "already_recorded",
      message: `Dose for ${targetMedicine} at ${targetScheduledTime} was already recorded today.`,
      dose: existingTaken,
    };
  }

  // 3. Create new TakenDose record in MongoDB 'medic'
  const takenDose = await TakenDose.create({
    medicine: targetMedicine,
    dosage: targetDosage,
    scheduledDate: today,
    scheduledTime: targetScheduledTime,
    takenTime: now,
  });

  // 4. If a MissedDose was prematurely logged for this slot today, remove it
  await MissedDose.deleteMany({
    medicine: targetMedicine,
    scheduledDate: today,
    scheduledTime: targetScheduledTime,
  });

  // 5. Update Alarm model status to 'taken' and set takenAt
  try {
    const alarmQuery = {
      $or: [{ medicine: targetMedicine }, { time: targetScheduledTime }]
    };
    if (userId) alarmQuery.userId = userId;
    if (alarmIndex !== undefined && alarmIndex !== null) alarmQuery.index = Number(alarmIndex);

    const activeAlarm = await Alarm.findOne(alarmQuery);
    if (activeAlarm) {
      activeAlarm.status = "taken";
      activeAlarm.takenAt = activeAlarm.takenAt || new Date();
      await activeAlarm.save();
    }
  } catch (err) {
    console.error("[ESP32] Error updating Alarm status to taken:", err);
  }

  console.log(`[ESP32] [TAKEN DOSE RECORDED] ${targetMedicine} (${targetDosage}) scheduled for ${targetScheduledTime}, taken at ${now} on ${today}`);

  return {
    status: "success",
    message: "Medicine dose recorded successfully via ESP32 confirmation.",
    dose: takenDose,
  };
}

/**
 * Check and record Missed Doses in MongoDB (medic database -> misseddoses collection)
 * Logic: If current time > scheduled time + 15 minutes and dose was NOT taken, mark as missed.
 */
async function checkAndRecordMissedDoses() {
  const today = getTodayDateString();
  const now = getCurrentTimeString();
  const nowMinutes = timeToMinutes(now);

  const enabledAlarms = await Alarm.find({ enabled: true });
  const recordedMissed = [];

  for (const alarm of enabledAlarms) {
    const scheduledMinutes = timeToMinutes(alarm.time);
    const elapsedMinutes = nowMinutes - scheduledMinutes;

    // Only evaluate if scheduled time has passed by 15 or more minutes on the current day
    if (elapsedMinutes >= MISSED_THRESHOLD_MINUTES) {
      // Check if taken
      const wasTaken = await TakenDose.findOne({
        medicine: alarm.medicine,
        scheduledDate: today,
        scheduledTime: alarm.time,
      });

      if (!wasTaken) {
        // Check if already marked as missed today
        const alreadyMarkedMissed = await MissedDose.findOne({
          medicine: alarm.medicine,
          scheduledDate: today,
          scheduledTime: alarm.time,
        });

        if (!alreadyMarkedMissed) {
          const missedDose = await MissedDose.create({
            medicine: alarm.medicine || "Prescribed Medicine",
            dosage: `${alarm.tablets || 1} tablet${(alarm.tablets || 1) > 1 ? "s" : ""}`,
            scheduledDate: today,
            scheduledTime: alarm.time,
          });

          console.log(`[ESP32] [MISSED DOSE DETECTED] ${alarm.medicine} was scheduled at ${alarm.time}. >15 mins passed without confirmation. Recorded to MissedDose.`);
          recordedMissed.push(missedDose);
        }

        if (alarm.status !== "taken" && alarm.status !== "missed") {
          alarm.status = "missed";
          await alarm.save();
        }
      }
    }
  }

  return recordedMissed;
}

// ==========================================
// Background Watcher
// ==========================================
let watcherIntervalId = null;

function startMissedDoseWatcher(intervalMs = 60000) {
  if (watcherIntervalId) return;
  console.log("[ESP32] Started automated 15-minute missed-dose watcher (checking every 60s)...");

  // Run initial check
  checkAndRecordMissedDoses().catch((err) => console.error("Initial missed dose check error:", err));

  // Check periodically
  watcherIntervalId = setInterval(async () => {
    try {
      await checkAndRecordMissedDoses();
    } catch (err) {
      console.error("[ESP32] Error running scheduled missed dose check:", err);
    }
  }, intervalMs);
}

function stopMissedDoseWatcher() {
  if (watcherIntervalId) {
    clearInterval(watcherIntervalId);
    watcherIntervalId = null;
    console.log("[ESP32] Stopped missed-dose watcher.");
  }
}

// ==========================================
// Express Router Endpoints for ESP32 & Web
// ==========================================

/**
 * POST /api/esp/button-press
 * Main endpoint called when the ESP32 button is pressed.
 *
 * Case A: ESP32 hardware detected 2 clicks:
 *   Body: { "clicks": 2, "userId": "...", "alarmIndex": 0 }
 *
 * Case B: ESP32 sends each raw click:
 *   Body: { "click": 1 }
 *   Server handles the 500ms double-click window.
 */
router.post("/button-press", async (req, res) => {
  try {
    const { clicks, click, userId, alarmIndex, medicine, dosage } = req.body;

    // Case A: Hardware detected double click directly
    if (Number(clicks) === 2 || req.body.action === "double_click") {
      const result = await recordTakenDose({ userId, alarmIndex, medicine, dosage });
      return res.status(200).json({
        event: "double_click_confirmed",
        ...result,
      });
    }

    // Case B: Streamed single clicks handled on server
    const now = Date.now();
    const timeSinceLast = now - buttonState.lastClickTime;

    if (timeSinceLast < DOUBLE_CLICK_WINDOW_MS && buttonState.clickCount === 1) {
      // 2nd click arrived within 500ms -> Double click!
      if (buttonState.timer) clearTimeout(buttonState.timer);
      buttonState.clickCount = 0;
      buttonState.lastClickTime = 0;

      const result = await recordTakenDose({ userId, alarmIndex, medicine, dosage });
      return res.status(200).json({
        event: "double_click_detected",
        ...result,
      });
    } else {
      // 1st click
      buttonState.clickCount = 1;
      buttonState.lastClickTime = now;

      try {
        const dueAlarm = await Alarm.findOne({ status: "due", enabled: true });
        if (dueAlarm) {
          dueAlarm.status = "opened";
          dueAlarm.openedAt = dueAlarm.openedAt || new Date();
          await dueAlarm.save();
        }
      } catch (err) {
        console.error("[ESP32] Error setting status to opened on click 1:", err);
      }

      if (buttonState.timer) clearTimeout(buttonState.timer);
      buttonState.timer = setTimeout(() => {
        // Reset if no second click arrived
        buttonState.clickCount = 0;
        buttonState.lastClickTime = 0;
      }, DOUBLE_CLICK_WINDOW_MS);

      return res.status(200).json({
        event: "first_click_registered",
        message: "Waiting for second click within 500ms to confirm medicine taken.",
      });
    }
  } catch (error) {
    console.error("[ESP32] Button press processing error:", error);
    res.status(500).json({ message: "Failed to process ESP32 button press", error: error.message });
  }
});

/**
 * POST /api/esp/dose-taken
 * Direct endpoint to record taken dose
 */
router.post("/dose-taken", async (req, res) => {
  try {
    const result = await recordTakenDose(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error("[ESP32] Dose-taken error:", error);
    res.status(500).json({ message: "Failed to record taken dose", error: error.message });
  }
});

/**
 * GET /api/esp/check-missed
 * Manually trigger missed doses check (evaluated against the 15-min rule)
 */
router.get("/check-missed", async (req, res) => {
  try {
    const missed = await checkAndRecordMissedDoses();
    res.status(200).json({
      message: "Missed doses check completed.",
      count: missed.length,
      missedDoses: missed,
    });
  } catch (error) {
    console.error("[ESP32] Missed doses check error:", error);
    res.status(500).json({ message: "Failed to check missed doses", error: error.message });
  }
});

/**
 * GET /api/esp/status
 * Returns system status, current time, enabled alarms, and today's summary
 */
router.get("/status", async (req, res) => {
  try {
    const today = getTodayDateString();
    const now = getCurrentTimeString();
    const alarms = await Alarm.find({ enabled: true }).sort({ time: 1 });
    const takenToday = await TakenDose.find({ scheduledDate: today });
    const missedToday = await MissedDose.find({ scheduledDate: today });

    res.json({
      serverTime: now,
      serverDate: today,
      missedThresholdMinutes: MISSED_THRESHOLD_MINUTES,
      activeAlarmsCount: alarms.length,
      alarms,
      takenCountToday: takenToday.length,
      missedCountToday: missedToday.length,
    });
  } catch (error) {
    res.status(500).json({ message: "Status retrieval failed", error: error.message });
  }
});

// ==========================================
// Standalone Runner (node esp.js)
// ==========================================
if (require.main === module) {
  const PORT = process.env.ESP_PORT || 3001;
  const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/medic";

  const app = express();
  app.use(express.json());
  app.use("/api/esp", router);

  mongoose
    .connect(MONGO_URI)
    .then(() => {
      console.log(`[ESP32 Service] Connected to MongoDB: ${MONGO_URI}`);
      startMissedDoseWatcher();

      app.listen(PORT, "0.0.0.0", () => {
        console.log(`[ESP32 Service] Running on port ${PORT}`);
        console.log(`- Double-click POST: http://localhost:${PORT}/api/esp/button-press`);
        console.log(`- Missed doses check: http://localhost:${PORT}/api/esp/check-missed`);
        console.log(`- System status: http://localhost:${PORT}/api/esp/status`);
      });
    })
    .catch((err) => {
      console.error("[ESP32 Service] MongoDB Connection Failed:", err);
    });
}

module.exports = {
  espRouter: router,
  recordTakenDose,
  checkAndRecordMissedDoses,
  startMissedDoseWatcher,
  stopMissedDoseWatcher,
  getTodayDateString,
  getCurrentTimeString,
  timeToMinutes,
};
