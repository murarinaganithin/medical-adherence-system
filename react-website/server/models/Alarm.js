const mongoose = require("mongoose");

const alarmSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    index: {
        type: Number,
        required: true,
        min: 0,
        max: 2
    },

    medicine: {
        type: String,
        trim: true
    },
    time: {
        type: String,
        required: true
    },
    tablets: {
        type: Number,
        required: true,
        min: 1
    },
    enabled: {
        type: Boolean,
        default: true
    },
    date: {
        type: String,
        default: null
    },
    lastActionDate: {
        type: String,
        default: null
    },
    scheduledAt: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ["scheduled", "due", "opened", "taken", "missed"],
        default: "scheduled"
    },
    openedAt: {
        type: Date,
        default: null
    },
    takenAt: {
        type: Date,
        default: null
    },
    acknowledgedAt: {
        type: Date,
        default: null
    },
        snoozedUntil: {
        type: Date,
        default: null
    },
    deviceId: {
        type: String,
        default: "ESP32_001"
    }
}, { timestamps: true });
// One alarm slot per user
alarmSchema.index(
    { userId: 1, index: 1 },
    { unique: true }
);

module.exports = mongoose.model("Alarm", alarmSchema);