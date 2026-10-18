
import { useEffect, useRef, useState } from "react";
import "./Alarm.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

function Alarm({ alarm, index }) {
  const [alarmTime, setAlarmTime] = useState(alarm?.time || "");
  const [enabled, setEnabled] = useState(alarm?.enabled || false);
  const [tabletCount, setTabletCount] = useState(alarm?.tablets || 1);
  const [medicine, setMedicine] = useState(alarm?.medicine || "");
  const [status, setStatus] = useState(alarm?.status || "scheduled");
  const [openedAt, setOpenedAt] = useState(alarm?.openedAt || null);
  const [takenAt, setTakenAt] = useState(alarm?.takenAt || null);
  const [saving, setSaving] = useState(false);

  // Prevent automatic refresh from overwriting unsaved edits.
  const editingRef = useRef(false);

  useEffect(() => {
    if (editingRef.current) return;

    setAlarmTime(alarm?.time || "");
    setEnabled(alarm?.enabled || false);
    setTabletCount(alarm?.tablets || 1);
    setMedicine(alarm?.medicine || "");
    setStatus(alarm?.status || "scheduled");
    setOpenedAt(alarm?.openedAt || null);
    setTakenAt(alarm?.takenAt || null);
  }, [alarm]);

  const saveAlarm = async () => {
    const user = JSON.parse(localStorage.getItem("user"));

    if (!user) {
      alert("Please login first");
      return;
    }

    if (!medicine.trim() || !alarmTime || Number(tabletCount) < 1) {
      alert("Please enter the medicine name, time, and valid tablet count");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API_URL}/api/alarms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          index,
          medicine: medicine.trim(),
          time: alarmTime,
          tablets: Number(tabletCount)
        })
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || "Failed to save alarm");
        return;
      }

      editingRef.current = false;
      setEnabled(true);
      setStatus("scheduled");
      setOpenedAt(null);
      setTakenAt(null);

      alert("Alarm saved/updated successfully!");
    } catch (error) {
      console.error("Failed to save alarm:", error);
      alert("Unable to connect to server");
    } finally {
      setSaving(false);
    }
  };

  const toggleAlarm = async () => {
    const user = JSON.parse(localStorage.getItem("user"));

    if (!user) {
      alert("Please login first");
      return;
    }

    if (enabled) {
      try {
        const response = await fetch(
          `${API_URL}/api/alarms/${user.id}/${index}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          alert(data.message || "Failed to turn off alarm");
          return;
        }

        editingRef.current = false;
        setEnabled(false);
        alert("Alarm turned off");
      } catch (error) {
        console.error(error);
        alert("Unable to connect to server");
      }

      return;
    }

    await saveAlarm();
  };

  const markEditing = () => {
    editingRef.current = true;
  };

  return (
    <div className="alarm">
      <h2>Alarm</h2>

      <input
        type="text"
        className="tablet-name"
        placeholder="Medicine name"
        value={medicine}
        onChange={(e) => {
          markEditing();
          setMedicine(e.target.value);
        }}
      />

      <input
        type="time"
        value={alarmTime}
        onChange={(e) => {
          markEditing();
          setAlarmTime(e.target.value);
        }}
      />

      <input
        type="number"
        min="1"
        step="1"
        className="tablet-count"
        placeholder="No. of tablets"
        value={tabletCount}
        onChange={(e) => {
          markEditing();
          setTabletCount(e.target.value);
        }}
      />

      <button onClick={saveAlarm} disabled={saving}>
        {saving ? "Saving..." : "Save / Update Alarm"}
      </button>

      {enabled && alarmTime && (
        <div className="alarm-info">
          <p>
            Alarm set for {alarmTime} — Take {tabletCount} tablet
            {Number(tabletCount) > 1 ? "s" : ""}
          </p>

          <p className="alarm-status">
            Status:{" "}
            <span className={`status-badge status-${status}`}>
              {status}
            </span>
          </p>

          {openedAt && (
            <p className="alarm-timestamp">
              Opened:{" "}
              {new Date(openedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })}
            </p>
          )}

          {takenAt && (
            <p className="alarm-timestamp">
              Taken:{" "}
              {new Date(takenAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })}
            </p>
          )}
        </div>
      )}

      <button onClick={toggleAlarm}>
        {enabled ? "OFF" : "ON"}
      </button>
    </div>
  );
}

export default Alarm;
