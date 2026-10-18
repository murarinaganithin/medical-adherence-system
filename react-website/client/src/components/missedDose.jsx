import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronRight } from "lucide-react";
import "./missedDose.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
    .format(new Date(`${date}T00:00:00`));
}

function formatTime(time) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(new Date(`1970-01-01T${time}:00`));
}

export default function MissedDose() {
  const [missedDoses, setMissedDoses] = useState([]);

  useEffect(() => {
    const fetchMissed = () => {
      fetch(`${API_URL}/api/missed-doses?limit=3`)
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then(setMissedDoses)
        .catch(() => setMissedDoses([]));
    };

    fetchMissed();
    const interval = setInterval(fetchMissed, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="missed-dose" aria-labelledby="missed-dose-title">
      <div className="missed-dose__header">
        <div>
          <p className="missed-dose__eyebrow">Medication history</p>
          <h2 id="missed-dose-title">Missed doses</h2>
        </div>
        <AlertCircle className="missed-dose__icon" aria-hidden="true" />
      </div>

      <ul className="missed-dose__list">
        {missedDoses.length ? missedDoses.map((dose) => (
          <li key={dose._id} className="missed-dose__item">
            <span className="missed-dose__date">{formatDate(dose.scheduledDate)}</span>
            <div>
              <h3>{dose.medicine}</h3>
              <p>{dose.dosage} · scheduled for {formatTime(dose.scheduledTime)}</p>
            </div>
          </li>
        )) : <li className="missed-dose__empty">No missed doses to show.</li>}
      </ul>

      <Link to="/calendar" className="missed-dose__more">
        Show more <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </section>
  );
}
