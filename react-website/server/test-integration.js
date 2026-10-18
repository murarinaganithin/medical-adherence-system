const mongoose = require("mongoose");
const http = require("http");
require("dotenv").config();

const BASE_URL = "http://localhost:3000";

let testUserId = null;
let testScheduleId = null;

async function runRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json"
      }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, data: parsed });
        } catch (err) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log("==================================================");
  console.log("STARTING END-TO-END INTEGRATION TEST SUITE");
  console.log("==================================================");

  // 1. TEST AUTHENTICATION
  console.log("\n[TEST 1] Authentication verification");
  const loginRes = await runRequest("POST", "/login", {
    phone: "1234567890",
    password: "111111"
  });
  assert(loginRes.status === 200, "Login returns HTTP 200 with valid credentials");
  assert(loginRes.data && loginRes.data.user && loginRes.data.user.id, "User object contains valid ID");
  testUserId = loginRes.data.user.id;

  const badLoginRes = await runRequest("POST", "/login", {
    phone: "1234567890",
    password: "wrong_password"
  });
  assert(badLoginRes.status === 401, "Login returns HTTP 401 with invalid credentials");

  // 2. TEST ALARM / SCHEDULE CREATION
  console.log("\n[TEST 2] Reminder scheduling (POST /api/alarms)");
  const now = new Date();
  const currentHour = String(now.getHours()).padStart(2, "0");
  const currentMinute = String(now.getMinutes()).padStart(2, "0");
  const currentTimeStr = `${currentHour}:${currentMinute}`;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const saveAlarmRes = await runRequest("POST", "/api/alarms", {
    userId: testUserId,
    index: 0,
    medicine: "Amoxicillin Test",
    time: currentTimeStr,
    tablets: 2
  });

  assert(saveAlarmRes.status === 200, "Saving alarm returns HTTP 200");
  assert(saveAlarmRes.data && saveAlarmRes.data.medicine === "Amoxicillin Test", "Alarm medicine saved correctly");
  assert(saveAlarmRes.data.status === "scheduled", "Alarm initial status is 'scheduled'");
  assert(saveAlarmRes.data.time === currentTimeStr, "Alarm time is set correctly for daily repetition");
  assert(saveAlarmRes.data.tablets === 2, "Alarm tablets count is 2");
  testScheduleId = saveAlarmRes.data._id;

  // 3. TEST GET /api/alarms/:userId
  console.log("\n[TEST 3] Fetch user alarms (GET /api/alarms/:userId)");
  const fetchAlarmsRes = await runRequest("GET", `/api/alarms/${testUserId}`);
  assert(fetchAlarmsRes.status === 200, "Fetch alarms returns HTTP 200");
  assert(Array.isArray(fetchAlarmsRes.data), "Fetch alarms returns an array");
  const found = fetchAlarmsRes.data.find(a => a._id === testScheduleId);
  assert(found !== undefined, "Saved alarm found in user alarm list");

  // 4. TEST DEVICE POLLING (GET /api/device/command)
  console.log("\n[TEST 4] ESP32 polling (GET /api/device/command)");
  const pollRes = await runRequest("GET", "/api/device/command");
  assert(pollRes.status === 200, "Device poll returns HTTP 200");
  assert(pollRes.data !== null, "Device poll returns due reminder object");
  assert(pollRes.data.id === testScheduleId, "Due reminder ID matches scheduled alarm");
  assert(pollRes.data.command === "ALARM", "Command is 'ALARM'");
  assert(pollRes.data.status === "due", "Reminder transitioned to 'due' status");
  assert(pollRes.data.medicine === "Amoxicillin Test", "Reminder medicine details are present");
  assert(pollRes.data.tablets === 2, "Reminder tablets details are present");

  // 5. TEST COMPARTMENT OPENING (POST /api/schedules/:id/opened) - Button Press 1
  console.log("\n[TEST 5] Compartment opened event (POST /api/schedules/:id/opened)");
  const openRes = await runRequest("POST", `/api/schedules/${testScheduleId}/opened`);
  assert(openRes.status === 200, "Opening endpoint returns HTTP 200");
  assert(openRes.data.schedule.status === "opened", "Schedule status updated to 'opened'");
  assert(openRes.data.schedule.openedAt !== null, "openedAt timestamp is recorded");
  const originalOpenedAt = openRes.data.schedule.openedAt;

  // 6. TEST IDEMPOTENCY OF OPENED ENDPOINT
  console.log("\n[TEST 6] Compartment opened idempotency");
  const repeatOpenRes = await runRequest("POST", `/api/schedules/${testScheduleId}/opened`);
  assert(repeatOpenRes.status === 200, "Repeated opening returns HTTP 200");
  assert(repeatOpenRes.data.schedule.openedAt === originalOpenedAt, "Original openedAt is preserved");

  // 7. TEST SINGLE-COMPARTMENT CONFLICT PREVENTION
  console.log("\n[TEST 7] Single-compartment concurrency conflict prevention");
  // While compartment is opened, device poll must return null
  const busyPollRes = await runRequest("GET", "/api/device/command");
  assert(busyPollRes.status === 200, "Busy poll returns HTTP 200");
  assert(busyPollRes.data === null, "Device poll returns null while compartment is opened");

  // 8. TEST MEDICINE COMPLETION (POST /api/schedules/:id/taken) - Button Press 2
  console.log("\n[TEST 8] Medicine completion event (POST /api/schedules/:id/taken)");
  const takenRes = await runRequest("POST", `/api/schedules/${testScheduleId}/taken`);
  assert(takenRes.status === 200, "Taken endpoint returns HTTP 200");
  assert(takenRes.data.schedule.status === "taken", "Schedule status updated to 'taken'");
  assert(takenRes.data.schedule.takenAt !== null, "takenAt timestamp is recorded");
  assert(takenRes.data.takenDose !== undefined, "TakenDose record was created in database");
  assert(takenRes.data.takenDose.medicine === "Amoxicillin Test", "TakenDose medicine is correct");

  // 9. TEST IDEMPOTENCY OF TAKEN ENDPOINT
  console.log("\n[TEST 9] Medicine completion idempotency");
  const repeatTakenRes = await runRequest("POST", `/api/schedules/${testScheduleId}/taken`);
  assert(repeatTakenRes.status === 200, "Repeated taken returns HTTP 200");
  assert(repeatTakenRes.data.status === "already_recorded", "Response indicates already_recorded");

  // 10. TEST TAKEN DOSES ENDPOINT (GET /api/taken-doses)
  console.log("\n[TEST 10] Taken doses history verification (GET /api/taken-doses)");
  const takenDosesRes = await runRequest("GET", "/api/taken-doses?limit=5");
  assert(takenDosesRes.status === 200, "Taken doses query returns HTTP 200");
  assert(Array.isArray(takenDosesRes.data), "Taken doses query returns array");
  const recordedTaken = takenDosesRes.data.find(d => d.medicine === "Amoxicillin Test");
  assert(recordedTaken !== undefined, "Newly confirmed taken dose appears in /api/taken-doses");

  // 11. TEST DEVICE POLL AFTER COMPLETION
  console.log("\n[TEST 11] Device poll after completion (no duplicate new alarm)");
  const afterTakenPoll = await runRequest("GET", "/api/device/command");
  assert(afterTakenPoll.status === 200, "Poll returns HTTP 200");
  assert(afterTakenPoll.data === null, "Device poll returns null (taken reminder is not re-triggered)");

  // 12. TEST INPUT VALIDATION & ERROR HANDLING
  console.log("\n[TEST 12] Input validation and error responses");
  const invalidIdOpen = await runRequest("POST", "/api/schedules/invalid-id/opened");
  assert(invalidIdOpen.status === 400, "Invalid ID format returns HTTP 400 for opened");

  const invalidIdTaken = await runRequest("POST", "/api/schedules/invalid-id/taken");
  assert(invalidIdTaken.status === 400, "Invalid ID format returns HTTP 400 for taken");

  const nonExistentId = new mongoose.Types.ObjectId().toString();
  const notFoundOpen = await runRequest("POST", `/api/schedules/${nonExistentId}/opened`);
  assert(notFoundOpen.status === 404, "Non-existent ID returns HTTP 404 for opened");

  // 13. TEST MISSED DOSE EVALUATION (esp.js background logic)
  console.log("\n[TEST 13] Missed dose logic verification");
  // Schedule an alarm in slot 1 for 20 minutes ago
  const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
  const pastTimeStr = `${String(twentyMinsAgo.getHours()).padStart(2, "0")}:${String(twentyMinsAgo.getMinutes()).padStart(2, "0")}`;

  const pastAlarmRes = await runRequest("POST", "/api/alarms", {
    userId: testUserId,
    index: 1,
    medicine: "Overdue Medicine Test",
    time: pastTimeStr,
    tablets: 1
  });
  assert(pastAlarmRes.status === 200, "Past alarm created successfully");

  // Trigger missed check
  const checkMissedRes = await runRequest("GET", "/api/esp/check-missed");
  assert(checkMissedRes.status === 200, "Check missed endpoint returns HTTP 200");

  const missedDosesRes = await runRequest("GET", "/api/missed-doses?limit=5");
  assert(missedDosesRes.status === 200, "Missed doses query returns HTTP 200");
  const foundMissed = missedDosesRes.data.find(d => d.medicine === "Overdue Medicine Test");
  assert(foundMissed !== undefined, "Overdue alarm was properly detected and recorded to MissedDose");

  // 14. CLEANUP TEST DATA
  console.log("\n[TEST 14] Test cleanup");
  const Alarm = require("./models/Alarm");
  const TakenDose = require("./models/TakenDose");
  const MissedDose = require("./models/MissedDose");

  await mongoose.connect(process.env.MONGO_URI);
  await Alarm.deleteMany({ userId: testUserId });
  await TakenDose.deleteMany({ medicine: "Amoxicillin Test" });
  await MissedDose.deleteMany({ medicine: "Overdue Medicine Test" });
  await mongoose.disconnect();
  console.log("  ✓ Test artifacts cleaned up successfully");

  console.log("\n==================================================");
  console.log("ALL 14 INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
