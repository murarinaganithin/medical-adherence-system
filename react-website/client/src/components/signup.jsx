
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, UserPlus } from "lucide-react";
import "./signup.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

function Signup() {
  const navigate = useNavigate();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (phone.length !== 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }

    if (password.length < 6) {
      setError("Password must contain at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(`${API_URL}/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          phone,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Signup failed.");
        return;
      }

      setSuccess("Account created successfully!");

      setTimeout(() => {
        navigate("/login");
      }, 1200);
    } catch (error) {
      console.error(error);
      setError("Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-page">

      {/* Background glows */}
      <div className="signup-glow signup-glow-1"></div>
      <div className="signup-glow signup-glow-2"></div>
      <div className="signup-glow signup-glow-3"></div>

      <div className="signup-container">

        {/* Header */}
        <div className="signup-header">

          <div className="signup-logo">
            <Activity className="signup-logo-icon" />
          </div>

          <h1>
            Welcome to MedAdhere<span>.</span>
          </h1>

          <p>
            Create your account to manage your medication
            schedule and stay on track.
          </p>

        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>

          <h2>
            <UserPlus />
            Create Account
          </h2>
          
          <div className="signup-input-group">

            <label>Name</label>

            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />

          </div>
          <div className="signup-input-group">

            <label>Phone Number</label>

            <input
              type="tel"
              placeholder="Enter your 10-digit phone number"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, ""))
              }
              maxLength="10"
              required
            />

          </div>

          <div className="signup-input-group">

            <label>Password</label>

            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

          </div>

          <div className="signup-input-group">

            <label>Confirm Password</label>

            <input
              type="password"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

          </div>

          {error && (
            <div className="signup-message signup-error">
              {error}
            </div>
          )}

          {success && (
            <div className="signup-message signup-success">
              {success}
            </div>
          )}

          <button
            type="submit"
            className="signup-btn"
            disabled={loading}
          >
            {loading ? "Creating Account..." : "Create Account"}
          </button>

          <p className="login-link">
            Already have an account?{" "}
            <Link to="/login">Login</Link>
          </p>

        </form>

      </div>
    </div>
  );
}

export default Signup;
