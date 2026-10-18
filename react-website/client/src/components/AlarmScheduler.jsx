import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function AlarmScheduler() {
    const [alarms, setAlarms] = useState([]);

    const alarmsRef = useRef([]);
    const triggeredAlarms = useRef(new Set());

    const audioRef = useRef(null);
    const audioUnlocked = useRef(false);

    // --------------------------------------------------
    // INITIALIZE ALARM AUDIO
    // --------------------------------------------------
    useEffect(() => {
        const audio = new Audio("/sounds/medicine-alarm.mp3");

        audio.loop = true;
        audio.preload = "auto";
        audio.volume = 1;

        audioRef.current = audio;

        const unlockAudio = async () => {
            if (audioUnlocked.current) return;

            try {
                audio.volume = 0;

                await audio.play();

                audio.pause();
                audio.currentTime = 0;
                audio.volume = 1;

                audioUnlocked.current = true;

                console.log("Alarm audio unlocked");
            } catch (error) {
                console.log(
                    "Could not unlock alarm audio yet:",
                    error.message
                );
            }
        };

        window.addEventListener("click", unlockAudio);
        window.addEventListener("keydown", unlockAudio);
        window.addEventListener("touchstart", unlockAudio);

        return () => {
            window.removeEventListener("click", unlockAudio);
            window.removeEventListener("keydown", unlockAudio);
            window.removeEventListener("touchstart", unlockAudio);

            audio.pause();
            audio.currentTime = 0;

            audioRef.current = null;
        };
    }, []);

    // --------------------------------------------------
    // FETCH ALARMS FROM MONGODB
    // --------------------------------------------------
    const fetchAlarms = async () => {
        const storedUser = localStorage.getItem("user");

        if (!storedUser) {
            console.log("No logged-in user found");
            return;
        }

        try {
            const user = JSON.parse(storedUser);

            const response = await fetch(
                `${API_URL}/api/alarms/${user.id}`
            );

            if (!response.ok) {
                console.error("Failed to fetch alarms");
                return;
            }

            const data = await response.json();

            console.log("Alarms loaded:", data);

            // Update both state and ref
            setAlarms(data);
            alarmsRef.current = data;
        } catch (error) {
            console.error("Alarm scheduler error:", error);
        }
    };

    // --------------------------------------------------
    // REQUEST NOTIFICATION PERMISSION
    // --------------------------------------------------
    const requestNotificationPermission = async () => {
        if (!("Notification" in window)) {
            console.log("Browser notifications are not supported.");
            return;
        }

        if (Notification.permission === "default") {
            try {
                const permission =
                    await Notification.requestPermission();

                console.log(
                    "Notification permission:",
                    permission
                );
            } catch (error) {
                console.error(
                    "Notification permission error:",
                    error
                );
            }
        }
    };

    // --------------------------------------------------
    // PLAY ALARM SOUND
    // --------------------------------------------------
    const playAlarmSound = () => {
        const audio = audioRef.current;

        if (!audio) {
            console.error("Alarm audio is not initialized");
            return;
        }

        console.log("PLAYING ALARM SOUND");

        audio.currentTime = 0;
        audio.volume = 1;
        audio.loop = true;

        audio.play()
            .then(() => {
                console.log("Alarm sound playing");
            })
            .catch((error) => {
                console.error(
                    "Alarm sound blocked:",
                    error
                );
            });

        // Stop after 30 seconds
        setTimeout(() => {
            if (audioRef.current === audio) {
                audio.pause();
                audio.currentTime = 0;

                console.log("Alarm sound stopped");
            }
        }, 30000);
    };

    // --------------------------------------------------
    // SHOW NOTIFICATION
    // --------------------------------------------------
    const showNotification = (alarm) => {
        if (!("Notification" in window)) {
            return;
        }

        if (Notification.permission !== "granted") {
            console.log("Notification permission not granted");
            return;
        }

        const notification = new Notification(
            "Time for your medicine",
            {
                body: `Take ${alarm.tablets} tablet${
                    alarm.tablets > 1 ? "s" : ""
                } of ${alarm.medicine}.`,
                tag: `medicine-alarm-${alarm.index}`
            }
        );

        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    };

    // --------------------------------------------------
    // CHECK ALARMS
    // --------------------------------------------------
    const checkAlarms = () => {
        const now = new Date();

        const currentHour = String(
            now.getHours()
        ).padStart(2, "0");

        const currentMinute = String(
            now.getMinutes()
        ).padStart(2, "0");

        const currentTime =
            `${currentHour}:${currentMinute}`;

        const currentKey =
            `${now.toDateString()}-${currentTime}`;

        // IMPORTANT:
        // Use the ref so we always have the latest alarms
        const currentAlarms = alarmsRef.current;

        currentAlarms.forEach((alarm) => {
            if (!alarm.enabled) {
                return;
            }

            if (!alarm.time) {
                return;
            }

            if (alarm.time !== currentTime) {
                return;
            }

            const triggerKey =
                `${alarm.index}-${currentKey}`;

            // Don't trigger the same alarm repeatedly
            // during the same minute
            if (
                triggeredAlarms.current.has(
                    triggerKey
                )
            ) {
                return;
            }

            triggeredAlarms.current.add(triggerKey);

            console.log(
                `Medicine alarm triggered: ${alarm.medicine} at ${alarm.time}`
            );

            playAlarmSound();
            showNotification(alarm);
        });

        // Prevent Set from growing forever
        if (
            triggeredAlarms.current.size > 100
        ) {
            triggeredAlarms.current.clear();
        }
    };

    // --------------------------------------------------
    // START SCHEDULER
    // --------------------------------------------------
    useEffect(() => {
        requestNotificationPermission();

        // Fetch immediately
        fetchAlarms();

        // Check immediately
        checkAlarms();

        // Check every second
        const interval = setInterval(() => {
            checkAlarms();
        }, 1000);

        // Refresh alarms from MongoDB every 30 seconds
        const alarmRefreshInterval =
            setInterval(() => {
                fetchAlarms();
            }, 30000);

        return () => {
            clearInterval(interval);
            clearInterval(alarmRefreshInterval);

            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
        };
    }, []);

    // This component doesn't render anything
    return null;
}