const express = require("express");
const mongoose = require("mongoose");
const Alarm = require("../models/Alarm");
const TakenDose = require("../models/TakenDose");
const MissedDose = require("../models/MissedDose");

const router = express.Router();

const MISSED_THRESHOLD_MINUTES = 15;

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
 * Find the next due reminder for daily repeating alarms:
 * - Daily repeating: Alarms repeat every day at their configured time.
 * - Single-compartment rule: If any reminder is currently opened, returns null (hardware busy).
 * - Priority rule: Earliest scheduled time is selected first among due reminders.
 * - Grace period / Missed: Reminders overdue by >= 15 minutes today are transitioned to 'missed'.
 * - Safe for retry: Once marked 'due', returned until acknowledged / opened / taken or expired.
 */
async function getNextDueReminder({ deviceId, userId } = {}) {
  const now = new Date();
  const today = getTodayDateString(now);
  const nowMinutes = timeToMinutes(getCurrentTimeString(now));

  const filter = { enabled: true };
  if (deviceId) {
    filter.deviceId = deviceId;
  }
  if (userId) {
    filter.userId = userId;
  }

  // 1. Single-compartment concurrency conflict prevention:
  // If the compartment is currently open for an active reminder today, wait until medicine taken is confirmed.
  const currentlyOpened = await Alarm.findOne({
    ...filter,
    status: "opened",
    $or: [{ lastActionDate: today }, { lastActionDate: null }]
  });
  if (currentlyOpened) {
    return null;
  }

  // 2. Check if there is an alarm currently marked 'due' for today (LED is ON, waiting for button 1)
  const currentlyDue = await Alarm.findOne({
    ...filter,
    status: "due",
    $or: [{ lastActionDate: today }, { lastActionDate: null }]
  });

  if (currentlyDue) {
    const scheduledMinutes = timeToMinutes(currentlyDue.time);
    const elapsedMinutes = nowMinutes - scheduledMinutes;

    if (elapsedMinutes >= MISSED_THRESHOLD_MINUTES) {
      // Overdue beyond grace period -> mark missed for today
      currentlyDue.status = "missed";
      currentlyDue.lastActionDate = today;
      await currentlyDue.save();

      const existingMissed = await MissedDose.findOne({
        medicine: currentlyDue.medicine,
        scheduledDate: today,
        scheduledTime: currentlyDue.time
      });

      if (!existingMissed) {
        await MissedDose.create({
          medicine: currentlyDue.medicine || "Prescribed Medicine",
          dosage: `${currentlyDue.tablets || 1} tablet${(currentlyDue.tablets || 1) > 1 ? "s" : ""}`,
          scheduledDate: today,
          scheduledTime: currentlyDue.time
        });
      }
      // Continue to check for other candidate alarms below
    } else {
      // Return currently active due alarm
      return currentlyDue;
    }
  }

  // 3. Find candidates among enabled daily alarms
  const candidates = await Alarm.find(filter).sort({ time: 1, index: 1, createdAt: 1 });

  for (const alarm of candidates) {
    // Check if dose was already taken today
    const wasTakenToday = await TakenDose.findOne({
      medicine: alarm.medicine,
      scheduledDate: today,
      scheduledTime: alarm.time
    });
    if (wasTakenToday) {
      continue;
    }

    // Check if dose was already marked missed today
    const wasMissedToday = await MissedDose.findOne({
      medicine: alarm.medicine,
      scheduledDate: today,
      scheduledTime: alarm.time
    });
    if (wasMissedToday) {
      continue;
    }

    // Check if alarm status is already taken/missed for today
    if (alarm.lastActionDate === today && (alarm.status === "taken" || alarm.status === "missed")) {
      continue;
    }

    const scheduledMinutes = timeToMinutes(alarm.time);
    const elapsedMinutes = nowMinutes - scheduledMinutes;

    // Check if scheduled time has arrived within the 15-minute window today
    if (elapsedMinutes >= 0 && elapsedMinutes < MISSED_THRESHOLD_MINUTES) {
      alarm.status = "due";
      alarm.lastActionDate = today;
      alarm.acknowledgedAt = new Date();
      await alarm.save();
      return alarm;
    } else if (elapsedMinutes >= MISSED_THRESHOLD_MINUTES) {
      // Overdue (>15 mins) for today, mark as missed so old alarms do not trigger unexpectedly
      alarm.status = "missed";
      alarm.lastActionDate = today;
      await alarm.save();

      const existingMissed = await MissedDose.findOne({
        medicine: alarm.medicine,
        scheduledDate: today,
        scheduledTime: alarm.time
      });

      if (!existingMissed) {
        await MissedDose.create({
          medicine: alarm.medicine || "Prescribed Medicine",
          dosage: `${alarm.tablets || 1} tablet${(alarm.tablets || 1) > 1 ? "s" : ""}`,
          scheduledDate: today,
          scheduledTime: alarm.time
        });
      }
    }
  }

  // 4. Backward compatibility with existing 'reminders' collection if present
  try {
    const reminderCol = mongoose.connection.db.collection("reminders");
    const openReminder = await reminderCol.findOne({
      status: "opened",
      ...(deviceId ? { deviceId } : {})
    });
    if (openReminder) return null;

    const dueReminder = await reminderCol.findOne({
      status: "due",
      ...(deviceId ? { deviceId } : {})
    });
    if (dueReminder) return dueReminder;

    const scheduledReminders = await reminderCol.find({
      status: "scheduled",
      ...(deviceId ? { deviceId } : {})
    }).sort({ scheduledAt: 1 }).toArray();

    for (const r of scheduledReminders) {
      const scheduledTime = new Date(r.scheduledAt).getTime();
      const elapsedMs = now.getTime() - scheduledTime;
      if (elapsedMs >= 0 && elapsedMs < MISSED_THRESHOLD_MINUTES * 60 * 1000) {
        await reminderCol.updateOne(
          { _id: r._id },
          { $set: { status: "due", updatedAt: new Date() } }
        );
        r.status = "due";
        return r;
      }
    }
  } catch (err) {
    // Legacy reminders query fallback error handled gracefully
  }

  return null;
}


router.get("/commands", async (req, res) => {
  try {
    const { deviceId, userId } = req.query;

    if (!deviceId || !userId) {
      return res.status(400).json({
        message: "deviceId and userId are required"
      });
    }

    const now = new Date();
    const today = getTodayDateString(now);
    const nowMinutes = timeToMinutes(getCurrentTimeString(now));

    const alarms = await Alarm.find({
      enabled: true,
      deviceId,
      userId
    }).sort({ index: 1 });

    const commands = [];

    for (const alarm of alarms) {
      const elapsed = nowMinutes - timeToMinutes(alarm.time);

      // Already completed or missed this slot today.
      if (
        alarm.lastActionDate === today &&
        ["taken", "missed"].includes(alarm.status)
      ) {
        continue;
      }

      // Keep an opened compartment active until its second button press.
      if (
        alarm.status === "opened" &&
        alarm.lastActionDate === today
      ) {
        commands.push({
          id: alarm._id.toString(),
          index: alarm.index,
          command: "ALARM",
          status: "opened",
          medicine: alarm.medicine,
          tablets: alarm.tablets,
          time: alarm.time
        });
        continue;
      }

      // Check whether this dose has already been recorded today.
      const wasTaken = await TakenDose.findOne({
        medicine: alarm.medicine,
        scheduledDate: today,
        scheduledTime: alarm.time
      });

      if (wasTaken) continue;

      const wasMissed = await MissedDose.findOne({
        medicine: alarm.medicine,
        scheduledDate: today,
        scheduledTime: alarm.time
      });

      if (wasMissed) continue;

      // Due window: scheduled time through the next 14 minutes.
      if (elapsed >= 0 && elapsed < MISSED_THRESHOLD_MINUTES) {
        if (
          alarm.status !== "due" ||
          alarm.lastActionDate !== today
        ) {
          alarm.status = "due";
          alarm.lastActionDate = today;
          alarm.acknowledgedAt = new Date();
          await alarm.save();
        }

        commands.push({
          id: alarm._id.toString(),
          index: alarm.index,
          command: "ALARM",
          status: "due",
          medicine: alarm.medicine,
          tablets: alarm.tablets,
          time: alarm.time
        });
      } else if (elapsed >= MISSED_THRESHOLD_MINUTES) {
        alarm.status = "missed";
        alarm.lastActionDate = today;
        await alarm.save();

        await MissedDose.create({
          medicine: alarm.medicine || "Prescribed Medicine",
          dosage: `${alarm.tablets || 1} tablet${alarm.tablets > 1 ? "s" : ""}`,
          scheduledDate: today,
          scheduledTime: alarm.time
        });
      }
    }

    res.json(commands);
  } catch (error) {
    console.error("Fetch device commands error:", error);
    res.status(500).json({
      message: "Failed to fetch device commands"
    });
  }
});


/**
 * GET /api/device/command
 * Polled by ESP32 over HTTP to retrieve due reminder or null.
 */
router.get("/command", async (req, res) => {
  try {
    const { deviceId, userId } = req.query;
    const due = await getNextDueReminder({ deviceId, userId });

    if (!due) {
      return res.status(200).json(null);
    }

    const today = getTodayDateString();
    const tabletsCount = due.tablets || 1;
    const dosageStr = due.dosage || `${tabletsCount} tablet${tabletsCount > 1 ? "s" : ""}`;

    return res.status(200).json({
      id: due._id.toString(),
      _id: due._id.toString(),
      command: "ALARM",
      deviceId: due.deviceId || "ESP32_001",
      medicine: due.medicine || "Prescribed Medicine",
      tablets: tabletsCount,
      dosage: dosageStr,
      time: due.time || getCurrentTimeString(),
      scheduledTime: due.time || getCurrentTimeString(),
      date: today,
      scheduledDate: today,
      scheduledAt: due.scheduledAt || new Date(),
      status: due.status
    });
  } catch (error) {
    console.error("[Device Command] Error processing poll:", error);
    res.status(500).json({ message: "Failed to retrieve device command", error: error.message });
  }
});

module.exports = {
  deviceRouter: router,
  getNextDueReminder,
  getTodayDateString,
  getCurrentTimeString,
  timeToMinutes
};
