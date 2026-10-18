import { useEffect, useState } from "react";
import {
    User,
    Phone,
    Calendar,
    HeartPulse,
    Droplets,
    Ruler,
    Weight,
    ShieldAlert,
    Pill,
    Stethoscope,
    Edit3,
    Save,
    X,
    Plus,
    Trash2
} from "lucide-react";
import "./MedicalHistory.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function MedicalHistory() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(false);

    const [formData, setFormData] = useState({
        dateOfBirth: "",
        gender: "",
        bloodGroup: "",
        height: "",
        weight: "",
        emergencyContact: "",
        emergencyContactName: "",
        allergies: [],
        chronicConditions: [],
        currentMedications: [],
        treatmentHistory: []
    });

    useEffect(() => {
        const storedUser = localStorage.getItem("user");

        if (!storedUser) {
            setLoading(false);
            return;
        }

        try {
            const parsedUser = JSON.parse(storedUser);
            setUser(parsedUser);
            fetchMedicalHistory(parsedUser.id);
        } catch (error) {
            console.error("Invalid user data:", error);
            setLoading(false);
        }
    }, []);

    const fetchMedicalHistory = async (userId) => {
        try {
            const response = await fetch(
                `${API_URL}/api/medical-history/${userId}`
            );

            const data = await response.json();

            if (response.ok) {
                setFormData({
                    dateOfBirth: data.dateOfBirth || "",
                    gender: data.gender || "",
                    bloodGroup: data.bloodGroup || "",
                    height: data.height || "",
                    weight: data.weight || "",
                    emergencyContact: data.emergencyContact || "",
                    emergencyContactName: data.emergencyContactName || "",
                    allergies: data.allergies || [],
                    chronicConditions: data.chronicConditions || [],
                    currentMedications: data.currentMedications || [],
                    treatmentHistory: data.treatmentHistory || []
                });
            }
        } catch (error) {
            console.error("Failed to fetch medical history:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;

        setFormData((prev) => ({
            ...prev,
            [name]: value
        }));
    };

    const handleArrayChange = (field, index, value) => {
        setFormData((prev) => {
            const updated = [...prev[field]];
            updated[index] = value;

            return {
                ...prev,
                [field]: updated
            };
        });
    };

    const addArrayItem = (field) => {
        setFormData((prev) => ({
            ...prev,
            [field]: [...prev[field], ""]
        }));
    };

    const removeArrayItem = (field, index) => {
        setFormData((prev) => ({
            ...prev,
            [field]: prev[field].filter((_, i) => i !== index)
        }));
    };

    const addTreatment = () => {
        setFormData((prev) => ({
            ...prev,
            treatmentHistory: [
                ...prev.treatmentHistory,
                {
                    diagnosis: "",
                    treatment: "",
                    doctor: "",
                    hospital: "",
                    startDate: "",
                    endDate: "",
                    notes: ""
                }
            ]
        }));
    };

    const updateTreatment = (index, field, value) => {
        setFormData((prev) => {
            const updated = [...prev.treatmentHistory];

            updated[index] = {
                ...updated[index],
                [field]: value
            };

            return {
                ...prev,
                treatmentHistory: updated
            };
        });
    };

    const removeTreatment = (index) => {
        setFormData((prev) => ({
            ...prev,
            treatmentHistory: prev.treatmentHistory.filter(
                (_, i) => i !== index
            )
        }));
    };

    const handleSave = async () => {
        if (!user) return;

        setSaving(true);

        try {
            const response = await fetch(
                `${API_URL}/api/medical-history/${user.id}`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(formData)
                }
            );

            const data = await response.json();

            if (!response.ok) {
                alert(data.message || "Failed to save medical history.");
                return;
            }

            setFormData({
                dateOfBirth: data.dateOfBirth || "",
                gender: data.gender || "",
                bloodGroup: data.bloodGroup || "",
                height: data.height || "",
                weight: data.weight || "",
                emergencyContact: data.emergencyContact || "",
                emergencyContactName: data.emergencyContactName || "",
                allergies: data.allergies || [],
                chronicConditions: data.chronicConditions || [],
                currentMedications: data.currentMedications || [],
                treatmentHistory: data.treatmentHistory || []
            });

            setEditing(false);
            alert("Medical history saved successfully.");
        } catch (error) {
            console.error("Failed to save medical history:", error);
            alert("Unable to connect to the server.");
        } finally {
            setSaving(false);
        }
    };

    const cancelEditing = () => {
        if (user) {
            fetchMedicalHistory(user.id);
        }

        setEditing(false);
    };

    if (loading) {
        return (
            <div className="medical-history-page">
                <div className="medical-history-loading">
                    Loading medical history...
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="medical-history-page">
                <div className="medical-history-empty">
                    <User size={40} />
                    <h2>Unable to load profile</h2>
                    <p>Please log in again.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="medical-history-page">
            <div className="medical-history-container">

                {/* Header */}
                <div className="medical-history-header">
                    <div>
                        <span className="page-label">PATIENT RECORD</span>
                        <h1>Medical History</h1>
                        <p>
                            Your personal medical information and treatment
                            history.
                        </p>
                    </div>

                    {!editing ? (
                        <button
                            className="edit-profile-btn"
                            onClick={() => setEditing(true)}
                        >
                            <Edit3 size={18} />
                            Edit Details
                        </button>
                    ) : (
                        <div className="edit-actions">
                            <button
                                className="cancel-btn"
                                onClick={cancelEditing}
                                disabled={saving}
                            >
                                <X size={18} />
                                Cancel
                            </button>

                            <button
                                className="save-btn"
                                onClick={handleSave}
                                disabled={saving}
                            >
                                <Save size={18} />
                                {saving ? "Saving..." : "Save Changes"}
                            </button>
                        </div>
                    )}
                </div>

                {/* Patient profile */}
                <section className="medical-card profile-card">
                    <div className="card-title">
                        <div className="title-icon">
                            <User size={20} />
                        </div>
                        <div>
                            <h2>Patient Profile</h2>
                            <p>Basic personal information</p>
                        </div>
                    </div>

                    <div className="profile-top">
                        <div className="profile-avatar">
                            {user.name?.charAt(0)?.toUpperCase() || "P"}
                        </div>

                        <div>
                            <h3>{user.name}</h3>
                            <p>{user.phone}</p>
                        </div>
                    </div>

                    <div className="details-grid">

                        <div className="detail-item">
                            <div className="detail-icon">
                                <User size={18} />
                            </div>
                            <div>
                                <span>Full Name</span>
                                <strong>{user.name || "Not provided"}</strong>
                            </div>
                        </div>

                        <div className="detail-item">
                            <div className="detail-icon">
                                <Phone size={18} />
                            </div>
                            <div>
                                <span>Phone</span>
                                <strong>{user.phone || "Not provided"}</strong>
                            </div>
                        </div>

                        {editing ? (
                            <>
                                <div className="form-field">
                                    <label>Date of Birth</label>
                                    <input
                                        type="date"
                                        name="dateOfBirth"
                                        value={formData.dateOfBirth}
                                        onChange={handleChange}
                                    />
                                </div>

                                <div className="form-field">
                                    <label>Gender</label>
                                    <select
                                        name="gender"
                                        value={formData.gender}
                                        onChange={handleChange}
                                    >
                                        <option value="">Select gender</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                        <option value="Other">Other</option>
                                        <option value="Prefer not to say">
                                            Prefer not to say
                                        </option>
                                    </select>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="detail-item">
                                    <div className="detail-icon">
                                        <Calendar size={18} />
                                    </div>
                                    <div>
                                        <span>Date of Birth</span>
                                        <strong>
                                            {formData.dateOfBirth || "Not provided"}
                                        </strong>
                                    </div>
                                </div>

                                <div className="detail-item">
                                    <div className="detail-icon">
                                        <User size={18} />
                                    </div>
                                    <div>
                                        <span>Gender</span>
                                        <strong>
                                            {formData.gender || "Not provided"}
                                        </strong>
                                    </div>
                                </div>
                            </>
                        )}

                        {editing ? (
                            <>
                                <div className="form-field">
                                    <label>Blood Group</label>
                                    <select
                                        name="bloodGroup"
                                        value={formData.bloodGroup}
                                        onChange={handleChange}
                                    >
                                        <option value="">Select blood group</option>
                                        <option value="A+">A+</option>
                                        <option value="A-">A-</option>
                                        <option value="B+">B+</option>
                                        <option value="B-">B-</option>
                                        <option value="AB+">AB+</option>
                                        <option value="AB-">AB-</option>
                                        <option value="O+">O+</option>
                                        <option value="O-">O-</option>
                                    </select>
                                </div>

                                <div className="form-field">
                                    <label>Height (cm)</label>
                                    <input
                                        type="number"
                                        name="height"
                                        value={formData.height}
                                        onChange={handleChange}
                                        min="0"
                                    />
                                </div>

                                <div className="form-field">
                                    <label>Weight (kg)</label>
                                    <input
                                        type="number"
                                        name="weight"
                                        value={formData.weight}
                                        onChange={handleChange}
                                        min="0"
                                    />
                                </div>

                                <div className="form-field">
                                    <label>Emergency Contact Name</label>
                                    <input
                                        type="text"
                                        name="emergencyContactName"
                                        value={formData.emergencyContactName}
                                        onChange={handleChange}
                                    />
                                </div>

                                <div className="form-field">
                                    <label>Emergency Contact</label>
                                    <input
                                        type="tel"
                                        name="emergencyContact"
                                        value={formData.emergencyContact}
                                        onChange={handleChange}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="detail-item">
                                    <div className="detail-icon">
                                        <Droplets size={18} />
                                    </div>
                                    <div>
                                        <span>Blood Group</span>
                                        <strong>
                                            {formData.bloodGroup || "Not provided"}
                                        </strong>
                                    </div>
                                </div>

                                <div className="detail-item">
                                    <div className="detail-icon">
                                        <Ruler size={18} />
                                    </div>
                                    <div>
                                        <span>Height</span>
                                        <strong>
                                            {formData.height
                                                ? `${formData.height} cm`
                                                : "Not provided"}
                                        </strong>
                                    </div>
                                </div>

                                <div className="detail-item">
                                    <div className="detail-icon">
                                        <Weight size={18} />
                                    </div>
                                    <div>
                                        <span>Weight</span>
                                        <strong>
                                            {formData.weight
                                                ? `${formData.weight} kg`
                                                : "Not provided"}
                                        </strong>
                                    </div>
                                </div>

                                <div className="detail-item">
                                    <div className="detail-icon">
                                        <Phone size={18} />
                                    </div>
                                    <div>
                                        <span>Emergency Contact</span>
                                        <strong>
                                            {formData.emergencyContactName
                                                ? `${formData.emergencyContactName} — ${formData.emergencyContact}`
                                                : formData.emergencyContact || "Not provided"}
                                        </strong>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* Allergies */}
                <section className="medical-card">
                    <div className="card-title">
                        <div className="title-icon warning">
                            <ShieldAlert size={20} />
                        </div>
                        <div>
                            <h2>Allergies</h2>
                            <p>Known allergies and reactions</p>
                        </div>
                    </div>

                    {editing ? (
                        <div className="editable-list">
                            {formData.allergies.map((allergy, index) => (
                                <div className="list-edit-row" key={index}>
                                    <input
                                        type="text"
                                        value={allergy}
                                        placeholder="e.g. Penicillin"
                                        onChange={(e) =>
                                            handleArrayChange(
                                                "allergies",
                                                index,
                                                e.target.value
                                            )
                                        }
                                    />
                                    <button
                                        className="remove-btn"
                                        onClick={() =>
                                            removeArrayItem("allergies", index)
                                        }
                                    >
                                        <Trash2 size={17} />
                                    </button>
                                </div>
                            ))}

                            <button
                                className="add-item-btn"
                                onClick={() => addArrayItem("allergies")}
                            >
                                <Plus size={17} />
                                Add Allergy
                            </button>
                        </div>
                    ) : (
                        <div className="tag-list">
                            {formData.allergies.length > 0 ? (
                                formData.allergies.map((allergy, index) => (
                                    <span className="medical-tag" key={index}>
                                        {allergy}
                                    </span>
                                ))
                            ) : (
                                <p className="empty-text">
                                    No known allergies recorded.
                                </p>
                            )}
                        </div>
                    )}
                </section>

                {/* Chronic conditions */}
                <section className="medical-card">
                    <div className="card-title">
                        <div className="title-icon">
                            <HeartPulse size={20} />
                        </div>
                        <div>
                            <h2>Chronic Conditions</h2>
                            <p>Long-term or ongoing medical conditions</p>
                        </div>
                    </div>

                    {editing ? (
                        <div className="editable-list">
                            {formData.chronicConditions.map((condition, index) => (
                                <div className="list-edit-row" key={index}>
                                    <input
                                        type="text"
                                        value={condition}
                                        placeholder="e.g. Hypertension"
                                        onChange={(e) =>
                                            handleArrayChange(
                                                "chronicConditions",
                                                index,
                                                e.target.value
                                            )
                                        }
                                    />
                                    <button
                                        className="remove-btn"
                                        onClick={() =>
                                            removeArrayItem(
                                                "chronicConditions",
                                                index
                                            )
                                        }
                                    >
                                        <Trash2 size={17} />
                                    </button>
                                </div>
                            ))}

                            <button
                                className="add-item-btn"
                                onClick={() =>
                                    addArrayItem("chronicConditions")
                                }
                            >
                                <Plus size={17} />
                                Add Condition
                            </button>
                        </div>
                    ) : (
                        <div className="tag-list">
                            {formData.chronicConditions.length > 0 ? (
                                formData.chronicConditions.map(
                                    (condition, index) => (
                                        <span className="medical-tag" key={index}>
                                            {condition}
                                        </span>
                                    )
                                )
                            ) : (
                                <p className="empty-text">
                                    No chronic conditions recorded.
                                </p>
                            )}
                        </div>
                    )}
                </section>

                {/* Current medications */}
                <section className="medical-card">
                    <div className="card-title">
                        <div className="title-icon">
                            <Pill size={20} />
                        </div>
                        <div>
                            <h2>Current Medications</h2>
                            <p>Medications currently being taken</p>
                        </div>
                    </div>

                    {editing ? (
                        <div className="editable-list">
                            {formData.currentMedications.map((medicine, index) => (
                                <div className="list-edit-row" key={index}>
                                    <input
                                        type="text"
                                        value={medicine}
                                        placeholder="e.g. Metformin 500mg"
                                        onChange={(e) =>
                                            handleArrayChange(
                                                "currentMedications",
                                                index,
                                                e.target.value
                                            )
                                        }
                                    />
                                    <button
                                        className="remove-btn"
                                        onClick={() =>
                                            removeArrayItem(
                                                "currentMedications",
                                                index
                                            )
                                        }
                                    >
                                        <Trash2 size={17} />
                                    </button>
                                </div>
                            ))}

                            <button
                                className="add-item-btn"
                                onClick={() =>
                                    addArrayItem("currentMedications")
                                }
                            >
                                <Plus size={17} />
                                Add Medication
                            </button>
                        </div>
                    ) : (
                        <div className="tag-list">
                            {formData.currentMedications.length > 0 ? (
                                formData.currentMedications.map(
                                    (medicine, index) => (
                                        <span className="medical-tag" key={index}>
                                            {medicine}
                                        </span>
                                    )
                                )
                            ) : (
                                <p className="empty-text">
                                    No current medications recorded.
                                </p>
                            )}
                        </div>
                    )}
                </section>

                {/* Treatment history */}
                <section className="medical-card">
                    <div className="card-title treatment-title">
                        <div className="title-icon">
                            <Stethoscope size={20} />
                        </div>
                        <div>
                            <h2>Past Treatment History</h2>
                            <p>Previous diagnoses, treatments and hospital visits</p>
                        </div>
                    </div>

                    {editing && (
                        <button
                            className="add-treatment-btn"
                            onClick={addTreatment}
                        >
                            <Plus size={17} />
                            Add Treatment Record
                        </button>
                    )}

                    {formData.treatmentHistory.length > 0 ? (
                        <div className="treatment-list">
                            {formData.treatmentHistory.map((record, index) => (
                                <div className="treatment-record" key={index}>
                                    {editing ? (
                                        <>
                                            <div className="treatment-record-header">
                                                <h3>
                                                    Treatment #{index + 1}
                                                </h3>

                                                <button
                                                    className="remove-btn"
                                                    onClick={() =>
                                                        removeTreatment(index)
                                                    }
                                                >
                                                    <Trash2 size={17} />
                                                </button>
                                            </div>

                                            <div className="treatment-form-grid">
                                                <div className="form-field">
                                                    <label>Diagnosis</label>
                                                    <input
                                                        type="text"
                                                        value={record.diagnosis}
                                                        onChange={(e) =>
                                                            updateTreatment(
                                                                index,
                                                                "diagnosis",
                                                                e.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="form-field">
                                                    <label>Treatment</label>
                                                    <input
                                                        type="text"
                                                        value={record.treatment}
                                                        onChange={(e) =>
                                                            updateTreatment(
                                                                index,
                                                                "treatment",
                                                                e.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="form-field">
                                                    <label>Doctor</label>
                                                    <input
                                                        type="text"
                                                        value={record.doctor}
                                                        onChange={(e) =>
                                                            updateTreatment(
                                                                index,
                                                                "doctor",
                                                                e.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="form-field">
                                                    <label>Hospital / Clinic</label>
                                                    <input
                                                        type="text"
                                                        value={record.hospital}
                                                        onChange={(e) =>
                                                            updateTreatment(
                                                                index,
                                                                "hospital",
                                                                e.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="form-field">
                                                    <label>Start Date</label>
                                                    <input
                                                        type="date"
                                                        value={record.startDate}
                                                        onChange={(e) =>
                                                            updateTreatment(
                                                                index,
                                                                "startDate",
                                                                e.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="form-field">
                                                    <label>End Date</label>
                                                    <input
                                                        type="date"
                                                        value={record.endDate}
                                                        onChange={(e) =>
                                                            updateTreatment(
                                                                index,
                                                                "endDate",
                                                                e.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="form-field full-width">
                                                    <label>Notes</label>
                                                    <textarea
                                                        value={record.notes}
                                                        onChange={(e) =>
                                                            updateTreatment(
                                                                index,
                                                                "notes",
                                                                e.target.value
                                                            )
                                                        }
                                                        rows="3"
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="treatment-record-header">
                                                <div>
                                                    <span className="treatment-label">
                                                        DIAGNOSIS
                                                    </span>
                                                    <h3>
                                                        {record.diagnosis ||
                                                            "Treatment Record"}
                                                    </h3>
                                                </div>

                                                {(record.startDate ||
                                                    record.endDate) && (
                                                    <span className="treatment-date">
                                                        {record.startDate || "—"}
                                                        {" → "}
                                                        {record.endDate || "Present"}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="treatment-details">
                                                {record.treatment && (
                                                    <div>
                                                        <span>Treatment</span>
                                                        <strong>
                                                            {record.treatment}
                                                        </strong>
                                                    </div>
                                                )}

                                                {record.doctor && (
                                                    <div>
                                                        <span>Doctor</span>
                                                        <strong>
                                                            {record.doctor}
                                                        </strong>
                                                    </div>
                                                )}

                                                {record.hospital && (
                                                    <div>
                                                        <span>Hospital / Clinic</span>
                                                        <strong>
                                                            {record.hospital}
                                                        </strong>
                                                    </div>
                                                )}
                                            </div>

                                            {record.notes && (
                                                <p className="treatment-notes">
                                                    {record.notes}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-treatment">
                            <Stethoscope size={30} />
                            <p>No previous treatment records available.</p>
                        </div>
                    )}
                </section>

            </div>
        </div>
    );
}