import "./OCR.css";
import { useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function OCR() {
    const fileInputRef = useRef(null);

    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");

    const handleChooseImage = () => {
        fileInputRef.current?.click();
    };

    const handleFile = async (file) => {
        if (!file) return;

        // 10 MB limit
        const maxSize = 10 * 1024 * 1024;

        if (file.size > maxSize) {
            setError("That file is larger than 10 MB.");
            return;
        }

        setSelectedFile(file);
        setResult(null);
        setError("");

        // Preview image
        if (file.type.startsWith("image/")) {
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
        } else {
            setPreviewUrl(null);
        }

        setLoading(true);

        try {
            const formData = new FormData();

            formData.append("image", file);

            const response = await fetch(
                `${API_URL}/api/ocr-reader`,
                {
                    method: "POST",
                    body: formData,
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "OCR failed");
            }

            setResult(data);
            setTimeout(() => {
                document.getElementById("ocr-result")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            }, 100);
        } catch (err) {
            console.error(err);
            setError(err.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (event) => {
        const file = event.target.files?.[0];
        handleFile(file);
    };

    const handleDrop = (event) => {
        event.preventDefault();

        const file = event.dataTransfer.files?.[0];

        if (file) {
            handleFile(file);
        }
    };

    const handleDragOver = (event) => {
        event.preventDefault();
    };

    return (
        <div className="ocr-page">

            {/* HEADER */}
            <header className="ocr-header">
                <div>
                    <p className="ocr-eyebrow">
                        DOCUMENT OCR
                    </p>

                    <h1>
                        Scan a medical document
                    </h1>

                    <p className="ocr-subtitle">
                        Upload a prescription or medicine label and
                        extract readable medication details.
                    </p>
                </div>

                <div className="ocr-status">
                    <span className="status-dot"></span>
                    {loading ? "Scanning..." : "OCR Ready"}
                </div>
            </header>


            {/* UPLOAD + CAMERA */}
            <div className="ocr-content">

                {/* IMAGE UPLOAD */}
                <section
                    className="ocr-upload-card"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
                    <div className="upload-icon">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                        >
                            <path d="M12 16V4" />
                            <path d="M7 9l5-5 5 5" />
                            <path d="M5 20h14" />
                        </svg>
                    </div>

                    <h2>
                        Drop your medical document here
                    </h2>

                    <p>
                        Upload your prescription or medicine label,
                        or browse your device.
                    </p>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf"
                        onChange={handleFileChange}
                        hidden
                    />

                    <button
                        className="upload-button"
                        onClick={handleChooseImage}
                        disabled={loading}
                    >
                        {loading ? "Scanning..." : "Choose file"}
                    </button>

                    <span className="upload-hint">
                        PNG, JPG, WEBP or PDF · Max 10 MB
                    </span>

                    {selectedFile && (
                        <p className="selected-file">
                            {selectedFile.name} ·{" "}
                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                    )}
                </section>


                {/* OR */}
                <div className="ocr-divider">
                    <span>OR</span>
                </div>


                {/* CAMERA */}
                <section className="camera-card">

                    <div className="camera-content">

                        <div className="camera-icon">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                            >
                                <path d="M4 7h3l2-2h6l2 2h3v12H4V7Z" />
                                <circle
                                    cx="12"
                                    cy="13"
                                    r="3.5"
                                />
                            </svg>
                        </div>

                        <div>
                            <h3>
                                Take a photo
                            </h3>

                            <p>
                                Use your camera to scan a prescription
                                directly.
                            </p>
                        </div>

                    </div>

                    <button
                        className="camera-button"
                        onClick={handleChooseImage}
                        disabled={loading}
                    >
                        Open Camera
                    </button>

                </section>

            </div>


            {/* WORKSPACE */}
            <section className="workspace-grid">

                {/* DOCUMENT PREVIEW */}
                <article className="panel preview-panel">

                    <div className="panel-heading">
                        <div>
                            <p className="panel-kicker">
                                SOURCE
                            </p>

                            <h2>
                                Document preview
                            </h2>
                        </div>

                        <span
                            className={`panel-state ${
                                selectedFile ? "is-ready" : ""
                            }`}
                        >
                            {selectedFile ? "Uploaded" : "Waiting"}
                        </span>
                    </div>


                    <div className="preview-frame">

                        {!selectedFile && (
                            <div className="empty-preview">
                                <div className="paper-icon">
                                    ▧
                                </div>

                                <p>
                                    Your uploaded document appears here
                                </p>
                            </div>
                        )}


                        {selectedFile &&
                            selectedFile.type.startsWith("image/") &&
                            previewUrl && (
                                <img
                                    src={previewUrl}
                                    alt="Uploaded medical document preview"
                                    className="preview-image"
                                />
                            )}


                        {selectedFile &&
                            selectedFile.type === "application/pdf" && (
                                <div className="empty-preview">
                                    <div className="paper-icon">
                                        ▧
                                    </div>

                                    <p>
                                        PDF uploaded
                                    </p>

                                    <span>
                                        Preview available after extraction
                                    </span>
                                </div>
                            )}

                    </div>

                </article>


                {/* OUTPUT */}
                <article className="panel text-panel" id="ocr-result">

                    <div className="panel-heading">
                        <div>
                            <p className="panel-kicker">
                                OUTPUT
                            </p>

                            <h2>
                                Extracted text
                            </h2>
                        </div>

                        <span className="panel-state">
                            {loading ? "Processing" : "Ready"}
                        </span>
                    </div>


                    {/* LOADING */}
                    {loading && (
                        <div className="medicine-result">
                            <h3>
                                Analyzing prescription...
                            </h3>

                            <p>
                                Please wait while the prescription
                                is being processed.
                            </p>
                        </div>
                    )}


                    {/* ERROR */}
                    {error && !loading && (
                        <div className="medicine-result error-result">
                            <h3>
                                OCR Error
                            </h3>

                            <p>
                                {error}
                            </p>
                        </div>
                    )}


                    {/* RESULTS */}
                    {!loading &&
                        !error &&
                        result?.medicines && (

                            result.medicines.length === 0 ? (
                                <div className="medicine-result">
                                    <h3>
                                        No medicines found
                                    </h3>

                                    <p>
                                        No medicines could be identified
                                        from this document.
                                    </p>
                                </div>
                            ) : (
                                result.medicines.map(
                                    (medicine, index) => (
                                        <div
                                            className="medicine-result"
                                            key={index}
                                        >
                                            <h3>
                                                {medicine.name ||
                                                    "Unknown medicine"}
                                            </h3>

                                            <p>
                                                <strong>
                                                    Strength:
                                                </strong>{" "}
                                                {medicine.strength ||
                                                    "Not detected"}
                                            </p>

                                            <p>
                                                <strong>
                                                    Quantity:
                                                </strong>{" "}
                                                {medicine.quantity ||
                                                    "Not detected"}
                                            </p>

                                            <p>
                                                <strong>
                                                    Frequency:
                                                </strong>{" "}
                                                {medicine.frequency ||
                                                    "Not detected"}
                                            </p>

                                            <p>
                                                <strong>
                                                    Timing:
                                                </strong>{" "}
                                                {medicine.timing ||
                                                    "Not detected"}
                                            </p>

                                            <p>
                                                <strong>
                                                    Instructions:
                                                </strong>{" "}
                                                {medicine.instructions ||
                                                    "Not detected"}
                                            </p>
                                        </div>
                                    )
                                )
                            )
                        )}


                    {/* NOTHING YET */}
                    {!loading &&
                        !error &&
                        !result && (
                            <div className="medicine-result empty-output">
                                <h3>
                                    No extraction yet
                                </h3>

                                <p>
                                    Upload a medical document to see
                                    the extracted medication details here.
                                </p>
                            </div>
                        )}

                </article>

            </section>


            {/* STATUS */}
            <p className="action-status">
                {loading
                    ? "Processing document..."
                    : error
                    ? error
                    : result
                    ? "Extraction completed."
                    : "Ready to extract"}
            </p>

        </div>
    );
}