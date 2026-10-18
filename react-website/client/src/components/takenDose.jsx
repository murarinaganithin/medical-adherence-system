import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, ChevronRight } from "lucide-react";
import "./takenDose.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function formatTime(time) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(`1970-01-01T${time}:00`));
}

export default function TakenDose() {
  const [takenDoses, setTakenDoses] = useState([]);

  useEffect(() => {
    const fetchTaken = () => {
      fetch(`${API_URL}/api/taken-doses?limit=3`)
        .then((response) =>
          response.ok ? response.json() : Promise.reject()
        )
        .then(setTakenDoses)
        .catch(() => setTakenDoses([]));
    };

    fetchTaken();
    const interval = setInterval(fetchTaken, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="taken-dose" aria-labelledby="taken-dose-title">
      <div className="taken-dose__header">
        <div>
          <p className="taken-dose__eyebrow">Medication history</p>
          <h2 id="taken-dose-title">Taken doses</h2>
        </div>

        <CheckCircle
          className="taken-dose__icon"
          aria-hidden="true"
        />
      </div>

      <ul className="taken-dose__list">
        {takenDoses.length ? (
          takenDoses.map((dose) => (
            <li key={dose._id} className="taken-dose__item">
              <span className="taken-dose__date">
                {formatDate(dose.scheduledDate)}
              </span>

              <div>
                <h3>{dose.medicine}</h3>
                <p>
                  {dose.dosage} · taken at{" "}
                  {formatTime(dose.takenTime)}
                </p>
              </div>
            </li>
          ))
        ) : (
          <li className="taken-dose__empty">
            No taken doses to show.
          </li>
        )}
      </ul>

      <Link to="/calendar" className="taken-dose__more">
        Show more
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </section>
  );
}
