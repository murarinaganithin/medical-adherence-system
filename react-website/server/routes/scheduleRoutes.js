const express = require("express");
const mongoose = require("mongoose");
const Alarm = require("../models/Alarm");
const TakenDose = require("../models/TakenDose");
const MissedDose = require("../models/MissedDose");

const router = express.Router();

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
 * Combines date string and time string into a Date object
 */
function getScheduledDate(dateStr, timeStr) {
  const today = getTodayDateString();
  const targetDate = dateStr || today;
  const targetTime = timeStr || "00:00";
  const [year, month, day] = targetDate.split("-").map(Number);
  const [hour, minute] = targetTime.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// ==========================================
// POST /api/schedules/:id/opened
// Compartment opening event reported by ESP32 (Button press 1)
// ==========================================
router.post("/:id/opened", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid schedule ID format." });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    // 1. Check in Alarm model
    let schedule = await Alarm.findById(objectId);

    if (schedule) {
      const now = new Date();
      const today = getTodayDateString(now);

      // Idempotency: Retain original openedAt if already opened or taken
      if (schedule.status !== "opened" && schedule.status !== "taken") {
        schedule.status = "opened";
        schedule.openedAt = schedule.openedAt || now;
        schedule.lastActionDate = today;
        schedule.snoozedUntil = null;
        await schedule.save();
      }

      console.log(`[ESP32 Integration] Compartment opened for schedule ${id}: ${schedule.medicine} at ${schedule.openedAt || now}`);

      return res.status(200).json({
        message: "Compartment opened recorded successfully.",
        schedule
      });
    }

    // 2. Compatibility fallback: check legacy 'reminders' collection
    try {
      const reminderCol = mongoose.connection.db.collection("reminders");
      const reminder = await reminderCol.findOne({ _id: objectId });
      if (reminder) {
        const now = new Date();
        await reminderCol.updateOne(
          { _id: objectId },
          {
            $set: {
              status: "opened",
              openedAt: reminder.openedAt || now,
              updatedAt: now
            }
          }
        );
        const updated = await reminderCol.findOne({ _id: objectId });
        return res.status(200).json({
          message: "Compartment opened recorded successfully.",
          schedule: updated
        });
      }
    } catch (err) {
      // Fallback query error
    }

    return res.status(404).json({ message: "Schedule not found." });
  } catch (error) {
    console.error("[Schedule] Error recording opening:", error);
    res.status(500).json({ message: "Failed to record compartment opening.", error: error.message });
  }
});

// ==========================================
// POST /api/schedules/:id/taken
// Medicine completion event reported by ESP32 (Button press 2)
// Note: The second button press represents the user's confirmation that they took the medicine.
// ==========================================
router.post("/:id/taken", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid schedule ID format." });
    }

    const objectId = new mongoose.Types.ObjectId(id);
    const now = new Date();
    const today = getTodayDateString(now);
    const currentTime = getCurrentTimeString(now);

    // 1. Check in Alarm model
    let schedule = await Alarm.findById(objectId);

    if (schedule) {
      // Idempotency check:
      if (schedule.status === "taken") {
        const existingTakenDose = await TakenDose.findOne({
          medicine: schedule.medicine,
          scheduledDate: schedule.date || today,
          scheduledTime: schedule.time
        });

        return res.status(200).json({
          message: "Medicine dose was already recorded as taken.",
          status: "already_recorded",
          schedule,
          takenDose: existingTakenDose
        });
      }

      // Update schedule record
      schedule.status = "taken";
      schedule.takenAt = schedule.takenAt || now;
      schedule.lastActionDate = today;
      await schedule.save();

      // Record in TakenDose collection for historical records and dashboard
      const dosageStr = `${schedule.tablets || 1} tablet${(schedule.tablets || 1) > 1 ? "s" : ""}`;
      const takenDose = await TakenDose.create({
        medicine: schedule.medicine || "Prescribed Medicine",
        dosage: dosageStr,
        scheduledDate: schedule.date || today,
        scheduledTime: schedule.time,
        takenTime: currentTime
      });

      // Remove any premature MissedDose record for this slot
      await MissedDose.deleteMany({
        medicine: schedule.medicine,
        scheduledDate: schedule.date || today,
        scheduledTime: schedule.time
      });

      console.log(`[ESP32 Integration] Medicine confirmation (2nd button press) for schedule ${id}: ${schedule.medicine} taken at ${currentTime}`);

      return res.status(200).json({
        message: "Medicine completion recorded successfully.",
        status: "success",
        schedule,
        takenDose
      });
    }

    // 2. Compatibility fallback: check legacy 'reminders' collection
    try {
      const reminderCol = mongoose.connection.db.collection("reminders");
      const reminder = await reminderCol.findOne({ _id: objectId });
      if (reminder) {
        if (reminder.status === "taken") {
          return res.status(200).json({
            message: "Medicine dose was already recorded as taken.",
            status: "already_recorded",
            schedule: reminder
          });
        }

        await reminderCol.updateOne(
          { _id: objectId },
          {
            $set: {
              status: "taken",
              takenAt: reminder.takenAt || now,
              updatedAt: now
            }
          }
        );

        const updated = await reminderCol.findOne({ _id: objectId });

        return res.status(200).json({
          message: "Medicine completion recorded successfully.",
          status: "success",
          schedule: updated
        });
      }
    } catch (err) {
      // Fallback query error
    }

    return res.status(404).json({ message: "Schedule not found." });
  } catch (error) {
    console.error("[Schedule] Error recording medicine completion:", error);
    res.status(500).json({ message: "Failed to record medicine completion.", error: error.message });
  }
});

// ==========================================
// POST /api/schedules/:id/ack
// Explicit device command acknowledgment
// ==========================================
router.post("/:id/ack", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid schedule ID format." });
    }

    const schedule = await Alarm.findById(id);
    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found." });
    }

    schedule.acknowledgedAt = schedule.acknowledgedAt || new Date();
    await schedule.save();

    return res.status(200).json({
      message: "Schedule command acknowledged successfully.",
      schedule
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to acknowledge schedule.", error: error.message });
  }
});

/*
 * POST /api/schedules/:id/snooze
 * Snooze an active medicine reminder for 10 minutes.
 */
router.post("/:id/snooze", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid schedule ID format."
      });
    }

    const minutes = Number(req.body.minutes ?? 10);

    if (!Number.isFinite(minutes) || minutes !== 10) {
      return res.status(400).json({
        success: false,
        message: "Snooze duration must be 10 minutes."
      });
    }

    const schedule = await Alarm.findById(id);

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Schedule not found."
      });
    }

    if (!schedule.enabled ||
        ["opened", "taken", "missed"].includes(schedule.status)) {
      return res.status(400).json({
        success: false,
        message: "This reminder cannot be snoozed."
      });
    }

    const now = new Date();

    schedule.snoozedUntil = new Date(
      now.getTime() + 10 * 60 * 1000
    );

    await schedule.save();

    console.log(
      `[Snooze] ${schedule.medicine} snoozed until ${schedule.snoozedUntil}`
    );

    return res.status(200).json({
      success: true,
      message: "Reminder snoozed for 10 minutes.",
      scheduleId: schedule._id,
      snoozedUntil: schedule.snoozedUntil
    });
  } catch (error) {
    console.error("[Snooze] Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to snooze reminder.",
      error: error.message
    });
  }
});

// ==========================================
// GET /api/schedules
// List schedules, with optional userId, deviceId, date, status filtering
// ==========================================
router.get("/", async (req, res) => {
  try {
    const { userId, deviceId, status, date } = req.query;
    const query = {};

    if (userId) query.userId = userId;
    if (deviceId) query.deviceId = deviceId;
    if (status) query.status = status;
    if (date) query.date = date;

    const schedules = await Alarm.find(query).sort({ date: 1, time: 1, index: 1 });
    res.status(200).json(schedules);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch schedules.", error: error.message });
  }
});

// ==========================================
// GET /api/schedules/:id
// Get a specific schedule by ID
// ==========================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid schedule ID format." });
    }

    const schedule = await Alarm.findById(id);
    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found." });
    }

    res.status(200).json(schedule);
  } catch (error) {
    res.status(500).json({ message: "Failed to get schedule.", error: error.message });
  }
});

// ==========================================
// POST /api/schedules
// Create or schedule a new reminder
// ==========================================
router.post("/", async (req, res) => {
  try {
    const { userId, index, medicine, date, time, tablets, deviceId } = req.body;

    if (!userId || !medicine || !time || tablets === undefined) {
      return res.status(400).json({
        message: "userId, medicine, time, and tablets are required."
      });
    }

    const targetDate = date || getTodayDateString();
    const scheduledAt = getScheduledDate(targetDate, time);

    let assignedIndex = index;
    if (assignedIndex === undefined || assignedIndex === null) {
      // Find lowest available index 0, 1, or 2 for user
      const existing = await Alarm.find({ userId });
      const usedIndices = new Set(existing.map((a) => a.index));
      assignedIndex = [0, 1, 2].find((idx) => !usedIndices.has(idx));
      if (assignedIndex === undefined) assignedIndex = 0;
    }

    const schedule = await Alarm.findOneAndUpdate(
      { userId, index: assignedIndex },
      {
        userId,
        index: assignedIndex,
        medicine: medicine.trim(),
        date: targetDate,
        time,
        scheduledAt,
        tablets: Number(tablets),
        enabled: true,
        status: "scheduled",
        deviceId: deviceId || "ESP32_001",
        openedAt: null,
        takenAt: null,
        acknowledgedAt: null
      },
      {
        new: true,
        upsert: true,
        runValidators: true
      }
    );

    res.status(201).json(schedule);
  } catch (error) {
    console.error("Create schedule error:", error);
    res.status(500).json({ message: "Failed to create schedule.", error: error.message });
  }
});

// ==========================================
// PATCH /api/schedules/:id
// Update an existing schedule
// ==========================================
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid schedule ID format." });
    }

    const { medicine, date, time, tablets, enabled, deviceId, status } = req.body;
    const updateData = {};

    if (medicine !== undefined) updateData.medicine = medicine.trim();
    if (date !== undefined) updateData.date = date;
    if (time !== undefined) updateData.time = time;
    if (tablets !== undefined) updateData.tablets = Number(tablets);
    if (deviceId !== undefined) updateData.deviceId = deviceId;
    if (status !== undefined) updateData.status = status;
    if (enabled !== undefined) {
      updateData.enabled = Boolean(enabled);
      if (Boolean(enabled)) {
        updateData.status = "scheduled";
        updateData.openedAt = null;
        updateData.takenAt = null;
      }
    }

    if (updateData.date || updateData.time) {
      const current = await Alarm.findById(id);
      if (current) {
        updateData.scheduledAt = getScheduledDate(
          updateData.date || current.date,
          updateData.time || current.time
        );
      }
    }

    const updated = await Alarm.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true
    });

    if (!updated) {
      return res.status(404).json({ message: "Schedule not found." });
    }

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: "Failed to update schedule.", error: error.message });
  }
});

module.exports = {
  scheduleRouter: router,
  getScheduledDate,
  getTodayDateString,
  getCurrentTimeString
};
