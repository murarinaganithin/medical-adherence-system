const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const app = express();
const PORT = process.env.PORT || 3000;
const URI = process.env.MONGO_URI;

// Middleware
app.use(cors());
app.use(express.json());

app.use(express.static("../client"));

// Routes import
const medicalHistoryRoutes = require("./routes/medicalHistoryRoutes");
const ocrReaderRoutes = require("./routes/ocrReaderRoutes");
const { espRouter, startMissedDoseWatcher } = require("./esp");
const { deviceRouter } = require("./routes/deviceRoutes");
const { scheduleRouter, getScheduledDate, getTodayDateString } = require("./routes/scheduleRoutes");

//using routes
app.use("/api/medical-history", medicalHistoryRoutes);
app.use("/api/ocr-reader", ocrReaderRoutes);
app.use("/api/esp", espRouter);
app.use("/api/device", deviceRouter);
app.use("/api/schedules", scheduleRouter);
app.use("/api/esp/device", deviceRouter);
app.use("/api/esp/schedules", scheduleRouter);

// ================================
// MongoDB Connection
// ================================

mongoose
  .connect(URI)
  .then(() => {
    console.log("MongoDB Connected");
    startMissedDoseWatcher();
  })
  .catch((err) => console.log("MongoDB Connection Error:", err));
// ================================
// User Model
// ================================
const User = require("./models/User");
const MissedDose = require("./models/MissedDose");
const TakenDose = require("./models/TakenDose");
const Alarm = require("./models/Alarm");
// ================================
// Home Route
// ================================

app.get("/", (req, res) => {
  res.send("Backend is running!");
});


// ================================
// SIGNUP
// ================================

app.post("/signup", async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    // Check required fields
    if (!name ||!phone || !password) {
      return res.status(400).json({
        message: "Name, Phone and password are required.",
      });
    }

    // Check phone number
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        message: "Phone number must contain exactly 10 digits.",
      });
    }

    // Check password length
    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must contain at least 6 characters.",
      });
    }

    // Check if phone already exists
    const existingUser = await User.findOne({ phone });

    if (existingUser) {
      return res.status(409).json({
        message: "Phone number is already registered.",
      });
    }

    // Create user
    const user = await User.create({
      name,
      phone,
      password,
    });

    res.status(201).json({
      message: "Account created successfully.",
      user: {
        id: user._id,
        phone: user.phone,
      },
    });

  } catch (error) {
    console.error("Signup Error:", error);
    
    res.status(500).json({
      message: "Failed to create account.",
    });
  }
});
// =================================
// Login
// =================================
app.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({
        message: "Phone and password are required"
      });
    }
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(401).json({
        message: "Invalid phone number or password"
      });
    }
    if (user.password !== password) {
      return res.status(401).json({
        message: "Invalid phone number or password"
      });
    }
    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error"
    });
  }
});
// ================================
// ADMIN - GET USERS - for fun 😏
// ================================

app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find();

    res.json(users);
  } catch (error) {
    console.error("Get Users Error:", error);

    res.status(500).json({
      message: "Failed to get users.",
    });
  }
});
// ================================
// TAKEN DOSES
// ================================

app.get("/api/taken-doses", async (req, res) => {
  try {
    const { start, end, limit } = req.query;

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (
      (start && !datePattern.test(start)) ||
      (end && !datePattern.test(end))
    ) {
      return res.status(400).json({
        message: "Dates must use YYYY-MM-DD format.",
      });
    }

    if (start && end && start > end) {
      return res.status(400).json({
        message: "start must be on or before end.",
      });
    }

    const query = {};

    if (start || end) {
      query.scheduledDate = {};

      if (start) query.scheduledDate.$gte = start;
      if (end) query.scheduledDate.$lte = end;
    }

    const parsedLimit = Number.parseInt(limit, 10);

    const dosesQuery = TakenDose.find(query).sort({
      scheduledDate: -1,
      takenTime: -1,
    });

    if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
      dosesQuery.limit(Math.min(parsedLimit, 100));
    }

    const doses = await dosesQuery.lean();

    res.json(doses);
  } catch (error) {
    console.error("Get taken doses error:", error);

    res.status(500).json({
      message: "Failed to get taken doses.",
    });
  }
});
app.post("/api/taken-doses", async (req, res) => {
  try {
    const {
      medicine,
      dosage,
      scheduledDate,
      scheduledTime,
      takenTime,
    } = req.body;

    if (
      !medicine ||
      !dosage ||
      !scheduledDate ||
      !scheduledTime ||
      !takenTime
    ) {
      return res.status(400).json({
        message: "All taken-dose fields are required.",
      });
    }

    const takenDose = await TakenDose.create({
      medicine,
      dosage,
      scheduledDate,
      scheduledTime,
      takenTime,
    });

    res.status(201).json(takenDose);
  } catch (error) {
    console.error("Save taken dose error:", error);

    res.status(500).json({
      message: "Failed to save taken dose.",
    });
  }
});
// ================================
// MISSED DOSES
// ================================

app.get("/api/missed-doses", async (req, res) => {
  try {
    const { start, end, limit } = req.query;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if ((start && !datePattern.test(start)) || (end && !datePattern.test(end))) {
      return res.status(400).json({ message: "Dates must use YYYY-MM-DD format." });
    }

    if (start && end && start > end) {
      return res.status(400).json({ message: "start must be on or before end." });
    }

    const query = {};
    if (start || end) {
      query.scheduledDate = {};
      if (start) query.scheduledDate.$gte = start;
      if (end) query.scheduledDate.$lte = end;
    }

    const parsedLimit = Number.parseInt(limit, 10);
    const dosesQuery = MissedDose.find(query).sort({ scheduledDate: -1, scheduledTime: -1 });
    if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
      dosesQuery.limit(Math.min(parsedLimit, 100));
    }

    const doses = await dosesQuery.lean();
    res.json(doses);
  } catch (error) {
    console.error("Get missed doses error:", error);
    res.status(500).json({ message: "Failed to get missed doses." });
  }
});

app.post("/api/missed-doses", async (req, res) => {
  try {
    const { medicine, dosage, scheduledDate, scheduledTime } = req.body;

    if (!medicine || !dosage || !scheduledDate || !scheduledTime) {
      return res.status(400).json({
        message: "All missed-dose fields are required.",
      });
    }

    const missedDose = await MissedDose.create({
      medicine,
      dosage,
      scheduledDate,
      scheduledTime,
    });

    res.status(201).json(missedDose);
  } catch (error) {
    console.error("Save missed dose error:", error);
    res.status(500).json({
      message: "Failed to save missed dose.",
    });
  }
});

// ====================================
// Save alarm time
// ======================================================
app.post("/api/alarms", async (req, res) => {
    try {
        const { userId, index, medicine, time, tablets, date, deviceId } = req.body;

        if (
            !userId ||
            index === undefined ||
            !medicine ||
            !time ||
            tablets === undefined
        ) {
            return res.status(400).json({
                message: "All alarm fields are required"
            });
        }

        if (index < 0 || index > 2) {
            return res.status(400).json({
                message: "Alarm index must be 0, 1, or 2"
            });
        }

        const targetDate = date || null;
        const scheduledAt = targetDate ? getScheduledDate(targetDate, time) : null;

        const alarm = await Alarm.findOneAndUpdate(
            { userId, index },
            {
                userId,
                index,
                medicine: medicine.trim(),
                time,
                date: targetDate,
                scheduledAt,
                tablets: Number(tablets),
                enabled: true,
                status: "scheduled",
                deviceId: deviceId || "ESP32_001",
                openedAt: null,
                takenAt: null,
                lastActionDate: null,
                acknowledgedAt: null
            },
            {
                new: true,
                upsert: true,
                runValidators: true
            }
        );

        res.status(200).json(alarm);

    } catch (error) {
        console.error("Save alarm error:", error);

        res.status(500).json({
            message: "Failed to save alarm"
        });
    }
});
app.patch("/api/alarms/:userId/:index", async (req, res) => {
    try {
        const { userId, index } = req.params;
        const { enabled } = req.body;

        if (enabled === undefined) {
            return res.status(400).json({
                message: "Enabled value is required"
            });
        }

        const updateData = { enabled: Boolean(enabled) };
        if (Boolean(enabled)) {
            updateData.status = "scheduled";
            updateData.openedAt = null;
            updateData.takenAt = null;
            updateData.lastActionDate = null;
            updateData.acknowledgedAt = null;
        }

        const alarm = await Alarm.findOneAndUpdate(
            { userId, index: Number(index) },
            updateData,
            {
                new: true,
                runValidators: true
            }
        );

        if (!alarm) {
            return res.status(404).json({
                message: "Alarm not found"
            });
        }

        res.json(alarm);

    } catch (error) {
        console.error("Update alarm status error:", error);

        res.status(500).json({
            message: "Failed to update alarm status"
        });
    }
});
app.get("/api/alarms/:userId", async (req, res) => {
    try {
        const alarms = await Alarm.find({
            userId: req.params.userId
        }).sort({ index: 1 });

        res.json(alarms);

    } catch (error) {
        console.error("Get alarms error:", error);

        res.status(500).json({
            message: "Failed to get alarms"
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
