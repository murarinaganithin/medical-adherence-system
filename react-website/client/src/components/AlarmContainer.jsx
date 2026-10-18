import { useEffect, useState } from "react";
import Alarm from "./Alarm";
import "./AlarmContainer.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

function AlarmContainer() {
    const [alarms, setAlarms] = useState([]);

    useEffect(() => {
        const fetchAlarms = async () => {
            const user = JSON.parse(localStorage.getItem("user"));
            if (!user) return;
            try {
                const response = await fetch(
                    `${API_URL}/api/alarms/${user.id}`
                );
                const data = await response.json();
                if (response.ok) {
                    setAlarms(data);
                }
            } catch (error) {
                console.error("Failed to fetch alarms:", error);
            }
        };

        fetchAlarms();
        const intervalId = setInterval(fetchAlarms, 3000);
        return () => clearInterval(intervalId);
    }, []);

    return (
        <div className="alarm-container">
            {[0, 1, 2].map((index) => (
                <Alarm
                    key={index}
                    index={index}
                    alarm={alarms.find((alarm) => alarm.index === index) || null}
                />
            ))}
        </div>
    );
}

export default AlarmContainer;